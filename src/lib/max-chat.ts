// Max's conversation in MaxSheet.astro. Messages stream from the studio (/api/public/max) as
// NDJSON events: text, products, cart, choices, handoff, done. Product and cart events render as
// cards; a cart can go straight to checkout (order-sheet.ts) or into the site cart.
// If the studio can't be reached, the visitor's message goes to the quote form instead.
import { STUDIO_API, fetchPrices, money, type PriceItemInput, type PriceResponse } from './online';
import { openOrder, type OrderArtwork } from './order-sheet';
import { addToCart, cartItems } from './cart';
import { countInks, type InkCount } from '../components/design/colors';
import { business } from '../data/business';
import { openMax } from './max';
import { setupVoice, type VoiceConfig } from './max-voice';
import { startLiveCall, LiveUnavailable } from './max-live';

type Msg = { role: 'user' | 'assistant'; content: string };
interface CartLine extends PriceItemInput { productId?: string; slug?: string; image?: string; why?: string; name?: string }
type MaxEvent =
  | { type: 'text'; delta: string }
  | { type: 'products'; items: { id: string; slug: string; name: string; brand?: string; style?: string; image?: string; why?: string }[] }
  | { type: 'cart'; items: CartLine[]; price?: PriceResponse; notes?: string[] }
  | { type: 'choices'; question?: string; options: { label: string; value: string }[] }
  | { type: 'handoff'; text?: string }
  | { type: 'error'; text: string }
  | { type: 'done' };

const KEY = 'tbsp-max-v1';
const sheet = document.querySelector<HTMLElement>('[data-max-sheet]');

if (sheet) {
  const log = sheet.querySelector<HTMLElement>('[data-max-log]')!;
  const intro = sheet.querySelector<HTMLElement>('[data-max-intro]')!;
  const form = sheet.querySelector<HTMLFormElement>('[data-max-form]')!;
  const input = sheet.querySelector<HTMLTextAreaElement>('#max-input')!;
  const send = sheet.querySelector<HTMLButtonElement>('[data-max-send]')!;
  const fileIn = sheet.querySelector<HTMLInputElement>('[data-max-file]')!;
  const filesBox = sheet.querySelector<HTMLElement>('[data-max-files]')!;
  const reset = sheet.querySelector<HTMLButtonElement>('[data-max-reset]')!;

  let messages: Msg[] = [];
  let sessionId = '';
  let busy = false;
  /** The visitor's logo(s), checked in the browser; sent to Max as a summary, kept for checkout. */
  const art: { file: File; ink: InkCount }[] = [];

  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (saved?.messages?.length) { messages = saved.messages; sessionId = saved.sessionId; }
  } catch { /* ignore */ }
  if (!sessionId) sessionId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify({ sessionId, messages: messages.slice(-30) })); } catch { /* ignore */ } };

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  };
  const scroll = () => requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  const bubble = (role: Msg['role'], text: string) => { const b = el('div', `max-bubble ${role === 'user' ? 'max-me' : 'max-bot'}`, text); log.append(b); scroll(); return b; };

  /** What Max should know about where the visitor is. */
  function context() {
    const path = location.pathname;
    const page = path === '/' ? 'home' : path.startsWith('/catalog/') && document.getElementById('add-to-quote') ? 'product' : path.startsWith('/quote-cart') ? 'cart' : path.startsWith('/catalog') ? 'catalog' : 'page';
    const f = document.getElementById('add-to-quote')?.dataset;
    const color = document.querySelector<HTMLElement>('.swatch[aria-checked="true"]')?.dataset.name;
    return {
      page, path,
      ...(f?.id ? { product: { id: f.id, name: f.name, brand: f.brand, style: f.style, color } } : {}),
      cart: cartItems().map((it) => ({ brand: it.brand, style: it.style, color: it.color, sizes: it.sizes, productName: it.name })),
      artwork: art.map(({ file, ink }) => ({ name: file.name, kind: ink.kind, ...(ink.kind === 'spot' ? { colors: ink.count } : {}), ...(ink.kind !== 'unknown' && !ink.vector ? { widthPx: ink.widthPx } : {}) })),
    };
  }

  // ── cards ──
  function productsCard(e: Extract<MaxEvent, { type: 'products' }>) {
    const rail = el('div', 'flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1');
    for (const p of e.items.slice(0, 8)) {
      const a = el('a', 'press shrink-0 w-36 rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-2 grid gap-1.5');
      a.href = `/catalog/${p.slug}/`;
      if (p.image) { const img = el('img', 'w-full aspect-square object-contain rounded-xl bg-zinc-50 dark:bg-white/[0.04]'); img.src = p.image; img.alt = ''; img.loading = 'lazy'; a.append(img); }
      a.append(el('span', 'text-[12.5px] font-semibold leading-snug text-zinc-900 dark:text-white line-clamp-2', p.name));
      if (p.why) a.append(el('span', 'text-[11.5px] muted leading-snug line-clamp-2', p.why));
      rail.append(a);
    }
    log.append(rail); scroll();
  }

  /** A cart line as the price/order APIs take it. */
  const forPrice = ({ productId: _a, slug: _b, image: _c, why: _d, name, ...x }: CartLine): PriceItemInput => ({ ...x, productName: x.productName || name });

  function cartCard(e: Extract<MaxEvent, { type: 'cart' }>) {
    const card = el('div', 'rounded-2xl border border-violet-300/60 dark:border-violet-400/25 bg-violet-500/[0.05] p-3.5 grid gap-3');
    card.append(el('p', 'text-[12px] font-bold uppercase tracking-[0.1em] text-violet-700 dark:text-violet-300', 'Your order, ready to go'));
    const pr = e.price && e.price.enabled ? e.price : null;
    e.items.forEach((it, i) => {
      const row = el('div', 'flex gap-3');
      if (it.image) { const img = el('img', 'w-14 h-14 shrink-0 rounded-xl object-contain bg-white dark:bg-white/[0.06] border border-zinc-200/80 dark:border-white/10'); img.src = it.image; img.alt = ''; row.append(img); }
      const info = el('div', 'min-w-0 flex-1 text-[13px] leading-snug');
      const name = el(it.slug ? 'a' : 'p', 'block font-semibold text-zinc-900 dark:text-white hover:underline', it.name || it.productName || `${it.brand} ${it.style}`);
      if (it.slug) (name as HTMLAnchorElement).href = `/catalog/${it.slug}/`;
      info.append(name);
      const qty = Object.values(it.sizes).reduce((a, b) => a + b, 0);
      info.append(el('p', 'muted', `${it.color} · ${qty} pcs (${Object.entries(it.sizes).map(([s, n]) => `${s} ${n}`).join(', ')})`));
      info.append(el('p', 'muted', it.locations.map((l) => `${l.placement}: ${l.method}${l.colors ? `, ${l.colors} color${l.colors === 1 ? '' : 's'}` : ''}`).join(' · ')));
      if (it.why) info.append(el('p', 'mt-0.5 text-violet-700 dark:text-violet-300', it.why));
      row.append(info);
      const p = pr?.items[i];
      if (p) row.append(el('p', 'shrink-0 text-right text-[13px] font-semibold text-zinc-900 dark:text-white', p.ok ? money(p.subtotal + p.setup) : 'Quote'));
      card.append(row);
    });
    if (pr?.totals) {
      const t = pr.totals;
      const tot = el('div', 'flex items-baseline justify-between border-t border-violet-300/40 pt-2 text-[14px]');
      tot.append(el('span', 'font-bold text-zinc-900 dark:text-white', 'Total before tax'), el('span', 'font-bold text-zinc-900 dark:text-white', money(t.subtotal + t.setup + (t.art || 0) + (t.rush || 0))));
      card.append(tot);
      if (t.readyBy) card.append(el('p', 'text-[12.5px] muted -mt-2', `Ready around ${new Date(t.readyBy).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} after proof approval.`));
    }
    for (const n of e.notes ?? []) card.append(el('p', 'text-[12.5px] text-emerald-700 dark:text-emerald-400', n));
    const actions = el('div', 'grid grid-cols-2 gap-2');
    const pay = el('button', 'btn-primary h-11 text-[14px]', 'Order & pay');
    const add = el('button', 'btn-quiet h-11 text-[14px]', 'Add to cart');
    pay.type = add.type = 'button';
    const ok = !!pr?.totals && pr.items.every((x) => x.ok);
    pay.disabled = !ok;
    pay.addEventListener('click', async () => {
      const res = await fetchPrices(e.items.map(forPrice));
      if (!res?.enabled || !res.totals || res.items.some((x) => !x.ok)) { bubble('assistant', 'Prices just changed, let me check again.'); return; }
      // The visitor's logo goes on each product's first location.
      const artwork: OrderArtwork[] = art.length ? e.items.map((it, i) => ({ itemIndex: i, placement: it.locations[0]?.placement || 'Front', file: art[0].file })) : [];
      const pieces = e.items.reduce((n, it) => n + Object.values(it.sizes).reduce((a, b) => a + b, 0), 0);
      openOrder({ items: e.items.map(forPrice), artwork, price: res, summary: `${e.items.length} product${e.items.length === 1 ? '' : 's'} · ${pieces} pieces` });
    });
    add.addEventListener('click', async () => {
      add.disabled = true;
      try {
        for (const it of e.items) {
          await addToCart({
            productId: it.productId || '', slug: it.slug || '', name: it.name || it.productName || `${it.brand} ${it.style}`, brand: it.brand, style: it.style, cat: '', sub: '',
            image: it.image || '', url: it.slug ? `${location.origin}/catalog/${it.slug}/` : location.origin, color: it.color,
            sizeOrder: Object.keys(it.sizes), sizes: it.sizes,
            decorations: [...new Set(it.locations.map((l) => l.method))], locations: it.locations.map((l) => l.placement),
            placements: [], mockups: [],
            inks: Object.fromEntries(it.locations.filter((l) => l.colors).map((l) => [l.placement, l.colors!])),
          });
        }
        add.textContent = 'Added ✓';
        bubble('assistant', `Added to your cart. ${art.length ? 'Add your logo on each product page, or send it with your order.' : ''}`.trim());
      } catch (err) {
        add.disabled = false;
        bubble('assistant', err instanceof Error ? err.message : 'Could not add to the cart.');
      }
    });
    actions.append(pay, add);
    card.append(actions);
    log.append(card); scroll();
  }

  function choicesCard(e: Extract<MaxEvent, { type: 'choices' }>) {
    if (e.question) bubble('assistant', e.question);
    const row = el('div', 'flex flex-wrap gap-2');
    for (const o of e.options.slice(0, 6)) {
      const b = el('button', 'chip !h-auto py-2 text-[13.5px]', o.label);
      b.type = 'button';
      b.addEventListener('click', () => { row.remove(); ask(o.value || o.label); });
      row.append(b);
    }
    log.append(row); scroll();
  }

  function handoffCard(e: Extract<MaxEvent, { type: 'handoff' }>) {
    if (e.text) bubble('assistant', e.text);
    const row = el('div', 'flex flex-wrap gap-2');
    for (const [label, href] of [['Call', `tel:${business.phone}`], ['Text', `sms:${business.phone}`], ['Email', `mailto:${business.email}`]]) {
      const a = el('a', 'chip !h-9 text-[13.5px] font-semibold', label); a.href = href; row.append(a);
    }
    log.append(row); scroll();
  }

  const voice = setupVoice(sheet, input, {
    onFinal: (t) => ask(t),
    say: (t) => bubble('assistant', t),
    // With live calls on, the mic starts (or ends) a call instead of push-to-talk.
    onMic: () => { if (!liveOn) return false; if (call || calling) endCall(); else void beginCall(); return true; },
  });
  // Closing the panel stops him mid-sentence and hangs up.
  new MutationObserver(() => { if (sheet.hidden) { voice.stop(); endCall(); } }).observe(sheet, { attributes: true, attributeFilter: ['hidden'] });

  // ── live call ──
  const callBar = sheet.querySelector<HTMLElement>('[data-max-call]')!;
  const callStatus = sheet.querySelector<HTMLElement>('[data-max-call-status]')!;
  const callOrb = sheet.querySelector<HTMLElement>('[data-max-call-orb]')!;
  const callMute = sheet.querySelector<HTMLButtonElement>('[data-max-call-mute]')!;
  const callCta = sheet.querySelector<HTMLButtonElement>('[data-max-call-cta]')!;
  const micBtn = sheet.querySelector<HTMLButtonElement>('[data-max-mic]')!;
  let liveOn = false;
  let calling = false;
  let call: Awaited<ReturnType<typeof startLiveCall>> | null = null;
  const live: Partial<Record<Msg['role'], HTMLElement>> = {};
  const paintCall = (on: boolean) => {
    callBar.hidden = !on;
    micBtn.classList.toggle('is-on', on);
    micBtn.querySelector('[data-idle]')!.toggleAttribute('hidden', on);
    micBtn.querySelector('[data-stop]')!.toggleAttribute('hidden', !on);
    micBtn.setAttribute('aria-label', on ? 'End the call' : 'Talk to Max');
    micBtn.title = on ? 'End the call' : 'Talk to Max';
    if (!on) callOrb.classList.remove('is-talking');
  };
  function endCall() { call?.end(); }
  async function beginCall() {
    if (calling || call) return;
    calling = true; voice.stop();
    intro.hidden = true; reset.hidden = false;
    paintCall(true); callStatus.textContent = 'Connecting…';
    callMute.setAttribute('aria-pressed', 'false');
    try {
      call = await startLiveCall(context, {
        status: (st, why) => {
          if (st === 'ended') {
            call = null; calling = false; paintCall(false);
            if (why === 'time') bubble('assistant', 'Our call timed out. Tap the mic to talk again, or keep typing.');
            else if (why === 'idle') bubble('assistant', 'I hung up since it got quiet. Tap the mic anytime to talk again, or keep typing.');
            else if (why === 'dropped') bubble('assistant', 'The call dropped. Tap the mic to talk again, or keep typing.');
            return;
          }
          callStatus.textContent = st === 'connecting' ? 'Connecting…' : st === 'talking' ? 'Max is talking…' : (call?.muted ? 'Muted' : 'Listening…');
          callOrb.classList.toggle('is-talking', st === 'talking');
        },
        caption: (who, text, done) => {
          if (!text) return;
          const b = live[who] || (live[who] = bubble(who, ''));
          b.textContent = text; scroll();
          if (done) { delete live[who]; messages.push({ role: who, content: text }); save(); }
        },
        events: (evs) => { for (const ev of evs as MaxEvent[]) render(ev); },
      });
      calling = false;
    } catch (err) {
      calling = false; call = null; paintCall(false);
      const name = (err as Error)?.name;
      if (name === 'NotAllowedError') bubble('assistant', 'I can’t hear you because the microphone is blocked. Allow it in your browser’s site settings, or just type.');
      else if (name === 'NotFoundError') bubble('assistant', 'I can’t find a microphone on this device. You can type instead.');
      else if (voice.canListen) { bubble('assistant', 'My call line is busy right now, so speak after the beep and I’ll answer here.'); voice.listen(); }
      else bubble('assistant', 'My call line is busy right now. Type your message and I’ll answer here.');
      void (err instanceof LiveUnavailable);
    }
  }
  callCta.addEventListener('click', () => void beginCall());
  sheet.querySelector('[data-max-call-end]')!.addEventListener('click', endCall);
  callMute.addEventListener('click', () => {
    if (!call) return;
    const m = !call.muted; call.setMuted(m);
    callMute.setAttribute('aria-pressed', String(m));
    callMute.querySelector('[data-on]')!.toggleAttribute('hidden', m);
    callMute.querySelector('[data-off]')!.toggleAttribute('hidden', !m);
    callMute.setAttribute('aria-label', m ? 'Unmute' : 'Mute'); callMute.title = m ? 'Unmute' : 'Mute';
    callStatus.textContent = m ? 'Muted' : 'Listening…';
  });

  // ── talking to the studio ──
  function typing() { const t = el('div', 'max-bubble max-bot max-typing'); t.innerHTML = '<span></span><span></span><span></span>'; t.setAttribute('aria-label', 'Max is typing'); log.append(t); scroll(); return t; }

  function render(ev: MaxEvent) {
    if (ev.type === 'products') productsCard(ev); else if (ev.type === 'cart') cartCard(ev); else if (ev.type === 'choices') choicesCard(ev); else if (ev.type === 'handoff') handoffCard(ev); else if (ev.type === 'error') bubble('assistant', ev.text);
  }

  async function ask(text: string) {
    text = text.trim();
    // On a call, typed text and tapped choices go to Max live.
    if (text && call) { bubble('user', text); messages.push({ role: 'user', content: text }); save(); call.sendText(text); return; }
    if (!text || busy) return;
    busy = true; send.disabled = true;
    intro.hidden = true; reset.hidden = false;
    bubble('user', text);
    messages.push({ role: 'user', content: text });
    save();
    const dots = typing();
    let reply = '';
    let out: HTMLElement | null = null;
    try {
      const res = await fetch(`${STUDIO_API}/api/public/max`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, messages, context: context() }) });
      // Max switched off: the studio answers plain JSON instead of a stream.
      if ((res.headers.get('content-type') || '').includes('application/json')) throw new Error('off');
      if (!res.body || (!res.ok && res.status !== 429)) throw new Error(String(res.status));
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: MaxEvent;
          try { ev = JSON.parse(line); } catch { continue; }
          dots.remove();
          if (ev.type === 'text') { if (!out) out = bubble('assistant', ''); reply += ev.delta; out.textContent = reply; scroll(); }
          else { out = null; render(ev); }
        }
      }
      dots.remove();
      if (reply) { messages.push({ role: 'assistant', content: reply }); save(); voice.speak(reply); }
    } catch {
      dots.remove();
      // Max isn't reachable: the message still reaches the team through the quote form.
      const b = bubble('assistant', "I can't reach the shop right now. Send this to our team and we'll reply within one business day, or call us.");
      const row = el('div', 'flex flex-wrap gap-2');
      const q = el('a', 'btn-primary h-10 text-[13.5px]', 'Send as a quote request'); q.href = `/quick-quote/?details=${encodeURIComponent(text)}`;
      const c = el('a', 'btn-quiet h-10 text-[13.5px]', `Call ${business.phoneDisplay}`); c.href = `tel:${business.phone}`;
      row.append(q, c); b.after(row); scroll();
    } finally {
      busy = false; send.disabled = false;
    }
  }

  // Other parts of the page (the home page's "Tell Max what you need") start a conversation.
  window.addEventListener('tbsp-max-ask', (e) => {
    const text = (e as CustomEvent<string>).detail || '';
    openMax('');
    input.value = '';
    if (text.trim()) ask(text);
  });

  // Is Max on? (cached a minute) The desktop button only shows when he is.
  (async () => {
    const fab = document.querySelector<HTMLElement>('[data-max-fab]');
    let on: boolean | null = null;
    let voiceCfg: VoiceConfig | null = null;
    let greeting = '', suggestions: string[] = [];
    try { const c = JSON.parse(sessionStorage.getItem('tbsp-max-on') || 'null'); if (c && Date.now() - c.at < 60_000) ({ on, voice: voiceCfg = null, greeting = '', suggestions = [] } = c); } catch { /* ignore */ }
    if (on === null) {
      const d = await fetch(`${STUDIO_API}/api/public/max`).then((r) => (r.ok ? r.json() : { enabled: false })).catch(() => ({ enabled: false }));
      on = !!d.enabled; voiceCfg = d.voice || null;
      greeting = typeof d.greeting === 'string' ? d.greeting.trim() : '';
      suggestions = Array.isArray(d.suggestions) ? d.suggestions.filter((x: unknown) => typeof x === 'string' && x.trim()).slice(0, 4) : [];
      try { sessionStorage.setItem('tbsp-max-on', JSON.stringify({ on, voice: voiceCfg, greeting, suggestions, at: Date.now() })); } catch { /* ignore */ }
    }
    voice.configure(voiceCfg);
    liveOn = !!(on && voiceCfg?.live && navigator.mediaDevices?.getUserMedia && 'WebSocket' in window && 'AudioWorkletNode' in window);
    // Talk by default: the chat opens on a big "Talk to Max" (one tap still starts it).
    callCta.hidden = !(liveOn && voiceCfg?.talkByDefault);
    // The admin's opening line and tap-to-ask suggestions (Settings › Online orders › Max).
    if (greeting) sheet.querySelector('[data-max-greeting]')!.textContent = greeting;
    if (suggestions.length) {
      const box = sheet.querySelector<HTMLElement>('[data-max-starters]')!;
      // Keep the send-your-logo chip unless the admin already offers logo help.
      const logo = suggestions.some((t) => /logo/i.test(t)) ? null : box.querySelector('[data-max-logo]');
      box.replaceChildren(...suggestions.map((t) => { const b = el('button', 'chip !h-auto py-2 text-left text-[13.5px]', t); b.type = 'button'; b.dataset.maxStarter = ''; return b; }), ...(logo ? [logo] : []));
    }
    // Max-only buttons and sections show once he's confirmed on (see [data-max-only] in global.css).
    document.documentElement.dataset.max = on ? 'on' : 'off';
    void fab;
  })();

  // Restore an earlier conversation in this tab (text only).
  if (messages.length) { intro.hidden = true; reset.hidden = false; for (const m of messages) bubble(m.role, m.content); }

  form.addEventListener('submit', (e) => { e.preventDefault(); voice.typed(); const t = input.value; input.value = ''; input.style.height = ''; ask(t); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 144)}px`; });
  sheet.querySelector('[data-max-starters]')!.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-max-starter]');
    if (!b) return;
    if (b.hasAttribute('data-max-logo')) { fileIn.click(); return; }
    voice.typed(); ask(b.textContent || '');
  });
  reset.addEventListener('click', () => {
    voice.stop(); endCall(); messages = []; art.length = 0; sessionId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()); save();
    [...log.children].forEach((c) => { if (c !== intro) c.remove(); });
    filesBox.replaceChildren(); filesBox.hidden = true;
    intro.hidden = false; reset.hidden = true;
  });

  // Logo: checked here (colors, full color, size) and summarized to Max.
  sheet.querySelector('[data-max-attach]')!.addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0]; fileIn.value = '';
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { bubble('assistant', 'That file is over 10 MB. Please send a smaller one, or email it to us.'); return; }
    const ink = await countInks(f).catch(() => ({ kind: 'unknown' }) as InkCount);
    art.splice(0, art.length, { file: f, ink });
    filesBox.hidden = false;
    filesBox.replaceChildren(el('span', 'chip !h-8 text-[12.5px]', `📎 ${f.name.slice(0, 40)}`));
    const summary = ink.kind === 'spot' ? `${ink.count} color${ink.count === 1 ? '' : 's'}` : ink.kind === 'full' ? 'full color' : 'file type I can’t preview';
    ask(`Here's my logo (${f.name}, ${summary}).`);
  });
}
