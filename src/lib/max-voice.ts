// Voice for Max (MaxSheet.astro), using what the browser already has: SpeechRecognition to talk
// to him (push to talk, live caption, sends when you stop) and speechSynthesis to hear his replies.
// No extra service or cost. The admin controls it through GET /api/public/max → voice.
// The mic only asks for permission when tapped; where the browser can't do it, the button stays hidden.

export interface VoiceConfig {
  /** Live calls with Max's natural voice (studio token + voice model). */
  live?: boolean;
  liveVoice?: string;
  /** Open the chat ready to talk (one tap still starts the call). */
  talkByDefault?: boolean;
  /** Show the mic. */
  listen?: boolean;
  /** Show the read-aloud toggle. */
  speak?: boolean;
  /** Read replies aloud after the visitor talked, unless they set the toggle themselves. */
  autoSpeak?: boolean;
  /** BCP-47, e.g. en-US. */
  lang?: string;
  /** Preferred browser voice, matched by substring. */
  voiceName?: string;
  /** 0.5–2. */
  rate?: number;
}

type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

const PREF = 'tbsp-max-speak';

export function setupVoice(sheet: HTMLElement, input: HTMLTextAreaElement, opts: { onFinal: (text: string) => void; say: (text: string) => void; /** Return true to take the mic tap (a live call). */ onMic?: () => boolean }) {
  const mic = sheet.querySelector<HTMLButtonElement>('[data-max-mic]')!;
  const speakBtn = sheet.querySelector<HTMLButtonElement>('[data-max-speak]')!;
  const listening = sheet.querySelector<HTMLElement>('[data-max-listening]')!;
  const listeningText = sheet.querySelector<HTMLElement>('[data-max-listening-text]')!;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  const Rec = w.SpeechRecognition || w.webkitSpeechRecognition;
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;

  let cfg: Required<Omit<VoiceConfig, 'voiceName'>> & { voiceName: string } = { listen: true, speak: true, autoSpeak: true, lang: 'en-US', voiceName: '', rate: 1 };
  let rec: Recognition | null = null;
  let heard = '';
  /** The visitor's last message was spoken. */
  let byVoice = false;

  const pref = (): 'on' | 'off' | null => { try { const v = localStorage.getItem(PREF); return v === 'on' || v === 'off' ? v : null; } catch { return null; } };
  const speaking = () => (pref() ?? (cfg.autoSpeak && byVoice ? 'on' : 'off')) === 'on';
  const paintSpeak = () => {
    const on = speaking();
    speakBtn.setAttribute('aria-pressed', String(on));
    speakBtn.querySelector('[data-on]')!.toggleAttribute('hidden', !on);
    speakBtn.querySelector('[data-off]')!.toggleAttribute('hidden', on);
    speakBtn.title = on ? 'Reading replies aloud (tap to mute)' : 'Read replies aloud';
  };

  // iOS only lets speech start from a tap; an empty utterance during one unlocks it for later.
  let unlocked = false;
  const unlock = () => { if (synth && !unlocked) { unlocked = true; const u = new SpeechSynthesisUtterance(''); u.volume = 0; synth.speak(u); } };

  function pickVoice() {
    const voices = synth?.getVoices() || [];
    const lang = cfg.lang.toLowerCase(), base = lang.split('-')[0];
    const want = cfg.voiceName.toLowerCase();
    return (want && voices.find((v) => v.name.toLowerCase().includes(want)))
      || voices.find((v) => v.lang.toLowerCase().replace('_', '-') === lang && /samantha|google us english|aria|jenny|natural/i.test(v.name))
      || voices.find((v) => v.lang.toLowerCase().replace('_', '-') === lang && v.localService)
      || voices.find((v) => v.lang.toLowerCase().startsWith(base))
      || null;
  }

  /** Read a finished reply aloud, if the visitor wants that. */
  function speak(text: string) {
    if (!synth || !cfg.speak || !speaking()) return;
    // Spoken, not read: no markdown, links, emoji or long numbers spelled out oddly.
    const clean = text
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[*_#`>|~]/g, '')
      .replace(/\p{Extended_Pictographic}/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = cfg.lang;
    u.rate = Math.min(2, Math.max(0.5, cfg.rate || 1));
    const v = pickVoice(); if (v) u.voice = v;
    synth.speak(u);
  }
  const hush = () => synth?.cancel();

  const setListening = (on: boolean) => {
    mic.classList.toggle('is-on', on);
    mic.querySelector('[data-idle]')!.toggleAttribute('hidden', on);
    mic.querySelector('[data-stop]')!.toggleAttribute('hidden', !on);
    mic.setAttribute('aria-label', on ? 'Stop listening' : 'Talk to Max');
    mic.title = on ? 'Stop listening' : 'Talk to Max';
    listening.hidden = !on;
    if (on) listeningText.textContent = 'Listening… speak now';
  };

  function stopListening() { rec?.stop(); }

  function startListening() {
    if (!Rec) return;
    hush(); unlock();
    heard = '';
    const before = input.value.trim();
    rec = new Rec();
    rec.lang = cfg.lang; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let final = '', interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]; const t = r[0]?.transcript || '';
        if (r.isFinal) final += t; else interim += t;
      }
      heard = (final + interim).trim();
      // Live caption in the box, after anything already typed.
      input.value = [before, heard].filter(Boolean).join(' ');
      input.dispatchEvent(new Event('input'));
      listeningText.textContent = 'Listening… tap ■ when you’re done';
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') opts.say('I can’t hear you because the microphone is blocked. Allow it in your browser’s site settings, or just type.');
      else if (e.error === 'no-speech') listeningText.textContent = 'I didn’t catch that';
      else if (e.error === 'audio-capture') opts.say('I can’t find a microphone on this device. You can type instead.');
    };
    rec.onend = () => {
      rec = null;
      setListening(false);
      const text = input.value.trim();
      if (heard && text) { byVoice = true; paintSpeak(); input.value = ''; input.dispatchEvent(new Event('input')); opts.onFinal(text); }
    };
    try { rec.start(); setListening(true); } catch { rec = null; setListening(false); }
  }

  mic.addEventListener('click', () => { if (!rec && opts.onMic?.()) return; if (rec) stopListening(); else startListening(); });
  speakBtn.addEventListener('click', () => {
    const on = !speaking();
    try { localStorage.setItem(PREF, on ? 'on' : 'off'); } catch { /* ignore */ }
    if (on) unlock(); else hush();
    paintSpeak();
  });

  /** Apply the admin's voice settings (GET /api/public/max). */
  function configure(c?: VoiceConfig | null) {
    cfg = {
      listen: c?.listen ?? true, speak: c?.speak ?? true, autoSpeak: c?.autoSpeak ?? true,
      lang: c?.lang || 'en-US', voiceName: c?.voiceName || '', rate: c?.rate || 1,
    };
    mic.hidden = !((Rec || c?.live) && cfg.listen);
    speakBtn.hidden = !(synth && cfg.speak);
    if (!mic.hidden || !speakBtn.hidden) paintSpeak();
  }
  configure(null);

  return {
    configure, speak, listen: startListening,
    /** The browser can do push-to-talk. */
    canListen: !!Rec,
    /** Typed messages: back to the visitor's own toggle (or quiet). */
    typed() { byVoice = false; unlock(); paintSpeak(); },
    stop() { hush(); if (rec) rec.abort(); },
  };
}
