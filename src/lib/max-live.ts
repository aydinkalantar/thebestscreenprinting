// A live voice call with Max (natural voice, talk over him to interrupt). The studio hands out a
// short-lived token (POST /api/public/max/voice) with his instructions, tools and voice locked
// in; the browser then talks straight to the voice model over a WebSocket:
//   mic → 16 kHz 16-bit mono PCM (base64) → { realtimeInput: { audio } }
//   ← serverContent.modelTurn.parts[].inlineData (24 kHz PCM) → played back in order
//   ← serverContent.inputTranscription / outputTranscription → captions in the chat
//   ← toolCall → POST /api/public/max/tool → cards in the chat + toolResponse
// Audio plumbing follows the CatchLead widget (worklet capture, gapless 24 kHz queue).

import { STUDIO_API } from './online';

export interface LiveEvents {
  /** Connecting → listening ⇄ talking → ended. */
  status: (s: 'connecting' | 'listening' | 'talking' | 'ended', why?: string) => void;
  /** Running caption of the current turn, per speaker. `done` closes the turn. */
  caption: (who: 'user' | 'assistant', text: string, done: boolean) => void;
  /** Cards from a tool (products, cart, choices, handoff), same shape as the chat stream. */
  events: (events: unknown[]) => void;
}

export class LiveUnavailable extends Error {}

// Captures mic audio at the device rate and posts 100 ms chunks resampled to 16 kHz.
const WORKLET = `
class MaxPcm extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(0); this.chunk = Math.round(sampleRate * 0.1); }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const nb = new Float32Array(this.buf.length + ch.length); nb.set(this.buf); nb.set(ch, this.buf.length); this.buf = nb;
    while (this.buf.length >= this.chunk) {
      const c = this.buf.slice(0, this.chunk); this.buf = this.buf.slice(this.chunk);
      const ratio = sampleRate / 16000, len = Math.round(c.length / ratio), out = new Int16Array(len);
      for (let i = 0; i < len; i++) {
        const si = i * ratio, k = Math.floor(si), f = si - k;
        const s = k + 1 < c.length ? c[k] * (1 - f) + c[k + 1] * f : c[k] || 0;
        out[i] = Math.max(-1, Math.min(1, s)) * 0x7fff;
      }
      this.port.postMessage(out.buffer, [out.buffer]);
    }
    return true;
  }
}
registerProcessor('max-pcm', MaxPcm);`;

const toB64 = (buf: ArrayBuffer) => {
  const b = new Uint8Array(buf); let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

export async function startLiveCall(context: () => unknown, on: LiveEvents, history: { role: 'user' | 'assistant'; content: string }[] = [], firstWords: () => string = () => '', welcomeBack = true) {
  // Audio must start inside the tap that began the call (iOS), so create both contexts first.
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  let out = new AC({ sampleRate: 24000 });
  const mic = new AC();
  void out.resume(); void mic.resume();
  let ws: WebSocket | null = null;
  let stream: MediaStream | null = null;
  let node: AudioWorkletNode | null = null;
  let ended = false;
  let muted = false;
  let nextAt = 0;
  const playing = new Set<AudioBufferSourceNode>();
  let heard = '', said = '';
  // Hang up once a goodbye has been said and Max finished talking.
  let lastHeard = '', byeAt = 0;
  const BYE_USER = /\b(bye|goodbye|that'?s (it|all)|no,? thanks?|i'?m (good|done)|have a good)\b/i;
  const BYE_MAX = /\b(bye|goodbye|have a (great|good|nice)|take care|talk (to you )?soon)\b/i;
  const hangUpWhenQuiet = () => { if (!playing.size && byeAt && !ended) end('bye'); };
  let timer = 0;
  let ready = false;
  let lastActive = Date.now();
  let idle = 0;

  const end = (why?: string) => {
    if (ended) return;
    ended = true;
    clearTimeout(timer); clearInterval(idle);
    document.removeEventListener('visibilitychange', onHide);
    try { ws?.close(); } catch { /* ignore */ }
    node?.disconnect(); stream?.getTracks().forEach((t) => t.stop());
    void mic.close().catch(() => {}); void out.close().catch(() => {});
    if (heard) on.caption('user', heard, true);
    if (said) on.caption('assistant', said, true);
    on.status('ended', why);
  };
  function onHide() { if (document.hidden) end('idle'); }
  const flush = () => { playing.forEach((s) => { try { s.stop(); } catch { /* ignore */ } }); playing.clear(); nextAt = 0; };
  const send = (m: unknown) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };

  try {
    on.status('connecting');
    // Mic permission and the token in parallel.
    const [s, res] = await Promise.all([
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
      fetch(`${STUDIO_API}/api/public/max/voice`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context: context() }) }),
    ]);
    stream = s;
    const t = res.ok ? await res.json().catch(() => null) : null;
    if (!t?.token || !t.wsUrl || t.enabled === false) throw new LiveUnavailable(String(res.status));

    // Mic → worklet → socket.
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await mic.audioWorklet.addModule(url); URL.revokeObjectURL(url);
    node = new AudioWorkletNode(mic, 'max-pcm');
    mic.createMediaStreamSource(stream).connect(node);
    // Only speech is sent (silence costs as much as talking): a simple voice gate with a
    // short pre-roll so first words aren't clipped, and a hold so pauses don't cut sentences.
    const pre: ArrayBuffer[] = [];
    let floor = 0.01, hold = 0, open = false;
    node.port.onmessage = (e) => {
      if (muted || !ready) return;
      const pcm = new Int16Array(e.data as ArrayBuffer);
      let sum = 0; for (let i = 0; i < pcm.length; i++) sum += (pcm[i] / 32768) ** 2;
      const rms = Math.sqrt(sum / (pcm.length || 1));
      // Track the room's noise level; Max's own voice leaking back needs a louder voice to break in.
      floor = rms < floor ? floor * 0.9 + rms * 0.1 : floor * 0.995 + rms * 0.005;
      const loud = rms > Math.max(0.015, floor * (playing.size ? 4 : 2.5));
      if (loud) { hold = 8; } else if (hold > 0) hold--;
      const chunk = { realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: '' } } };
      if (hold > 0) {
        if (!open) { open = true; for (const b of pre.splice(0)) { chunk.realtimeInput.audio.data = toB64(b); send(chunk); } }
        chunk.realtimeInput.audio.data = toB64(e.data); send(chunk);
        lastActive = Date.now();
      } else {
        if (open) { open = false; send({ realtimeInput: { audioStreamEnd: true } }); }
        pre.push(e.data); if (pre.length > 3) pre.shift();
      }
    };

    ws = new WebSocket(`${t.wsUrl}${t.wsUrl.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(t.token)}`);
    await new Promise<void>((resolve, reject) => {
      const fail = () => reject(new LiveUnavailable('socket'));
      ws!.onerror = fail;
      ws!.onclose = fail;
      ws!.onopen = () => send({ setup: { model: t.model } });
      ws!.onmessage = async (e) => {
        const m = await parse(e.data);
        if (m?.setupComplete) { ready = true; resolve(); }
      };
      setTimeout(() => reject(new LiveUnavailable('timeout')), 15_000);
    });

    ws.onerror = null;
    ws.onclose = (e) => end(e.code === 1000 ? undefined : 'dropped');
    ws.onmessage = async (e) => {
      const m = await parse(e.data);
      if (!m || ended) return;
      const sc = m.serverContent;
      if (sc) {
        if (sc.interrupted) { flush(); on.status('listening'); }
        lastActive = Date.now();
        if (sc.inputTranscription?.text) { byeAt = 0; heard += sc.inputTranscription.text; on.caption('user', heard.trim(), false); }
        if (sc.outputTranscription?.text) {
          if (heard) { lastHeard = heard; on.caption('user', heard.trim(), true); heard = ''; }
          said += sc.outputTranscription.text; on.caption('assistant', said.trim(), false);
        }
        for (const p of sc.modelTurn?.parts || []) if (p.inlineData?.data) play(p.inlineData.data);
        if (sc.turnComplete || sc.interrupted) {
          const reply = said;
          if (heard) { lastHeard = heard; on.caption('user', heard.trim(), true); heard = ''; }
          if (said) { on.caption('assistant', said.trim(), true); said = ''; }
          if (sc.turnComplete && BYE_MAX.test(reply) && BYE_USER.test(lastHeard)) { byeAt = Date.now(); setTimeout(hangUpWhenQuiet, 400); }
        }
      }
      if (m.toolCall?.functionCalls?.length) {
        const responses = await Promise.all(m.toolCall.functionCalls.map(async (c: { id: string; name: string; args?: unknown }) => {
          // Max ends the call himself once the visitor is done (after his goodbye plays).
          if (/^(end_call|hang_up)$/.test(c.name)) { byeAt = Date.now(); setTimeout(hangUpWhenQuiet, 400); return { id: c.id, name: c.name, response: { result: { ok: true } } }; }
          try {
            const r = await fetch(`${STUDIO_API}/api/public/max/tool`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: c.name, args: c.args || {}, context: context() }) }).then((x) => x.json());
            if (Array.isArray(r.events) && r.events.length) on.events(r.events);
            return { id: c.id, name: c.name, response: { result: r.result ?? null } };
          } catch {
            return { id: c.id, name: c.name, response: { result: { error: 'That didn’t work. Try again or offer the quote form.' } } };
          }
        }));
        send({ toolResponse: { functionResponses: responses } });
      }
      if (m.goAway) end('time');
    };
    on.status('listening');
    // Newer studios hand a cue that makes Max say the admin greeting first, in the right language.
    // A new call picks up the conversation so far (typed or spoken), so Max remembers the visitor.
    const past = history.filter((h) => h.content.trim()).slice(-20);
    // A message the visitor sent while connecting (a home page prompt, say) opens the call instead of the greeting.
    const first = firstWords();
    if (past.length) send({ clientContent: { turns: past.map((h) => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content.slice(0, 1500) }] })), turnComplete: false } });
    // Back after a short break (a dropped or quiet call): no welcome, Max just listens.
    if (past.length && !first && welcomeBack) {
      send({ realtimeInput: { text: '[call resumed: the visitor is back. Welcome them back in one short sentence and ask what they need now. Only bring up the earlier conversation if they do. Do not repeat the greeting]' } });
    }
    if (first) send({ realtimeInput: { text: first } });
    else if (!past.length && typeof t.start === 'string' && t.start) send({ realtimeInput: { text: t.start } });
    // The call can last 30 minutes.
    timer = window.setTimeout(() => end('time'), 29.5 * 60_000);
    // Hang up when nobody has spoken for a while, or the visitor leaves the tab (saves the line).
    idle = window.setInterval(() => {
      if (byeAt && Date.now() - byeAt > 8000) end('bye');
      if (!playing.size && Date.now() - lastActive > 45_000) end('idle'); }, 5000);
    document.addEventListener('visibilitychange', onHide);
  } catch (err) {
    end();
    throw err instanceof LiveUnavailable || (err as Error)?.name === 'NotAllowedError' || (err as Error)?.name === 'NotFoundError' ? err : new LiveUnavailable(String(err));
  }

  let outGain: GainNode | null = null;
  const gain = () => { if (!outGain || outGain.context !== out) { outGain = out.createGain(); outGain.gain.value = 0.9; outGain.connect(out.destination); } return outGain; };

  function play(b64: string) {
    const bin = atob(b64);
    const n = bin.length >> 1, f = new Float32Array(n);
    for (let i = 0; i < n; i++) { const v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); f[i] = (v > 0x7fff ? v - 0x10000 : v) / 32768; }
    if (out.state === 'closed') out = new AC({ sampleRate: 24000 });
    const buf = out.createBuffer(1, n, 24000); buf.copyToChannel(f, 0);
    const src = out.createBufferSource(); src.buffer = buf; src.connect(gain());
    const now = out.currentTime; if (nextAt < now) nextAt = now + 0.12;
    src.start(nextAt); nextAt += buf.duration;
    playing.add(src); on.status('talking');
    src.onended = () => { playing.delete(src); if (!playing.size && !ended) { on.status('listening'); setTimeout(hangUpWhenQuiet, 600); } };
  }

  return {
    end: () => end(),
    /** Typed text during the call. */
    sendText(text: string) { lastActive = Date.now(); lastHeard = text; byeAt = 0; send({ realtimeInput: { text } }); },
    /** Mute the mic (Max still talks). */
    setMuted(m: boolean) { muted = m; if (m) send({ realtimeInput: { audioStreamEnd: true } }); },
    get muted() { return muted; },
  };
}

// Messages may arrive as text or binary JSON.
async function parse(d: unknown): Promise<any> {
  try {
    const s = typeof d === 'string' ? d : d instanceof Blob ? await d.text() : new TextDecoder().decode(d as ArrayBuffer);
    return JSON.parse(s);
  } catch { return null; }
}
