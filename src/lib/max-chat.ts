// Max's conversation in MaxSheet.astro. Messages stream from the studio (/api/public/max) as
// NDJSON events: text, products, cart, choices, handoff, done. Product and cart events render as
// cards; a cart can go straight to checkout (order-sheet.ts) or into the site cart.
// If the studio can't be reached, the visitor's message goes to the quote form instead.
import { STUDIO_API, fetchPrices, money, type PriceItemInput, type PriceResponse } from './online';
import { openOrder, type OrderArtwork } from './order-sheet';
import { addToCart, cartItems, putFile } from './cart';
import { countInks, type InkCount } from '../components/design/colors';
import { business } from '../data/business';
import { openMax } from './max';
import { setupVoice, type VoiceConfig } from './max-voice';
import { startLiveCall, LiveUnavailable } from './max-live';
import { getContact, saveContact, forgetContact, isEmail, type Contact } from './contact';

type Msg = { role: 'user' | 'assistant'; content: string };
interface CartLine extends Omit<PriceItemInput, 'locations'> {
  locations: (PriceItemInput['locations'][number] & { artId?: string })[];
  productId?: string; slug?: string; image?: string; why?: string; name?: string }
type MaxEvent =
  | { type: 'text'; delta: string }
  | { type: 'products'; items: { id: string; slug: string; name: string; brand?: string; style?: string; image?: string; why?: string }[] }
  | { type: 'cart'; items: CartLine[]; price?: PriceResponse; notes?: string[] }
  | { type: 'choices'; question?: string; options: { label: string; value: string }[] }
  | { type: 'handoff'; text?: string }
  | ({ type: 'contact' } & Contact)
  | { type: 'forget' }
  | { type: 'placement'; artId: string; productId?: string; placement: string; method: string; colors?: number; widthIn?: number }
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
  /** When the conversation was last active (a call only picks it up if it's recent). */
  let lastAt = 0;
  /** Language of Max's voice (admin setting), to tell real words from transcribed room noise. */
  let voiceLang = 'en-US';
  let sessionId = '';
  let busy = false;
  /** The visitor's logo(s), checked in the browser; sent to Max as a summary, kept for checkout. */
  const art: { id: string; file: File; ink: InkCount; url?: string }[] = [];
  let artSeq = 0;
  const artById = (id?: string) => (id ? art.find((a) => a.id === id) : undefined);
  /** The design Max put on a location; with a single design, it goes on each product's first location. */
  const artFor = (loc: { artId?: string }, li: number) => artById(loc.artId) ?? (art.length === 1 && li === 0 && !loc.artId ? art[0] : undefined);

  try {
    // Kept on this device for a week, so Max remembers a visitor who closes the chat or comes back later.
    const saved = JSON.parse(localStorage.getItem(KEY) || sessionStorage.getItem(KEY) || 'null');
    if (saved?.messages?.length && (!saved.at || Date.now() - saved.at < 7 * 864e5)) { messages = saved.messages; sessionId = saved.sessionId; lastAt = saved.at || 0; }
  } catch { /* ignore */ }
  if (!sessionId) sessionId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
  const save = () => { lastAt = Date.now(); try { localStorage.setItem(KEY, JSON.stringify({ sessionId, messages: messages.slice(-30), at: lastAt })); } catch { /* ignore */ } };

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  };
  const scroll = () => requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  const bubble = (role: Msg['role'], text: string) => { const b = el('div', `max-bubble ${role === 'user' ? 'max-me' : 'max-bot'}`, text); log.append(b); scroll(); return b; };

  const resetAt = () => { try { return Number(localStorage.getItem('tbsp-max-reset-at')) || 0; } catch { return 0; } };
  /** When the last call ended: a call within a few minutes of it skips the welcome back. */
  let lastCallEnd = 0;

  /** What Max should know about where the visitor is. */
  function context() {
    const path = location.pathname;
    const page = path === '/' ? 'home' : path.startsWith('/catalog/') && document.getElementById('add-to-quote') ? 'product' : path.startsWith('/quote-cart') ? 'cart' : path.startsWith('/catalog') ? 'catalog' : 'page';
    const f = document.getElementById('add-to-quote')?.dataset;
    const color = document.querySelector<HTMLElement>('.swatch[aria-checked="true"]')?.dataset.name;
    return {
      page, path,
      ...(f?.id ? { product: { id: f.id, name: f.name, brand: f.brand, style: f.style, color } } : {}),
      // Confirmed details, so Max can greet by name and fill the order.
      ...(getContact() ? { contact: getContact() } : {}),
      // The site cart, minus what was there before the visitor started over (an old order shouldn't steer Max).
      cart: cartItems().filter((it) => it.addedAt > resetAt()).map((it) => ({ brand: it.brand, style: it.style, color: it.color, sizes: it.sizes, productName: it.name })),
      artwork: art.map(({ id, file, ink }) => ({ id, name: file.name, kind: ink.kind, ...(ink.kind === 'spot' ? { colors: ink.count } : {}), ...(ink.kind !== 'unknown' && !ink.vector ? { widthPx: ink.widthPx } : {}) })),
    };
  }

  // ── cards ──
  /** Products Max has shown, to put a design on the right page. */
  const seen = new Map<string, { slug: string; name: string; image?: string }>();
  function productsCard(e: Extract<MaxEvent, { type: 'products' }>) {
    for (const p of e.items) seen.set(p.id, { slug: p.slug, name: p.name, image: p.image });
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
      for (const [li, l] of it.locations.entries()) {
        const a = artFor(l, li);
        const line = el('p', 'muted flex items-center gap-1.5');
        if (a?.url) { const t = el('img', 'w-5 h-5 rounded object-contain bg-zinc-400/70 dark:bg-zinc-600'); t.src = a.url; t.alt = ''; line.append(t); }
        line.append(el('span', '', `${l.placement}: ${l.method}${l.colors ? `, ${l.colors} color${l.colors === 1 ? '' : 's'}` : ''}${a ? ` · ${a.file.name.slice(0, 28)}` : ''}`));
        info.append(line);
      }
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
      // Each location's design, as Max placed them.
      const artwork: OrderArtwork[] = e.items.flatMap((it, i) => it.locations.flatMap((l, li) => { const a = artFor(l, li); return a ? [{ itemIndex: i, placement: l.placement, file: a.file }] : []; }));
      const pieces = e.items.reduce((n, it) => n + Object.values(it.sizes).reduce((a, b) => a + b, 0), 0);
      openOrder({ items: e.items.map(forPrice), artwork, price: res, summary: `${e.items.length} product${e.items.length === 1 ? '' : 's'} · ${pieces} pieces` });
    });
    /** One of Max's products as a cart item, with each location's design attached (placed on the product page). */
    const toCart = (it: CartLine) => addToCart({
            productId: it.productId || '', slug: it.slug || '', name: it.name || it.productName || `${it.brand} ${it.style}`, brand: it.brand, style: it.style, cat: '', sub: '',
            image: it.image || '', url: it.slug ? `${location.origin}/catalog/${it.slug}/` : location.origin, color: it.color,
            sizeOrder: Object.keys(it.sizes), sizes: it.sizes,
            decorations: [...new Set(it.locations.map((l) => l.method))], locations: it.locations.map((l) => l.placement),
            placements: it.locations.flatMap((l, li) => {
              const a = artFor(l, li);
              return a ? [{ locId: '', location: l.placement, decoration: l.method, file: a.file.name, blob: a.file as Blob, widthIn: l.widthIn || 0, heightIn: l.heightIn || 0, fromTopIn: 0, fromCenterIn: 0, x: 0, y: 0, w: 0 }] : [];
            }),
            mockups: [],
            inks: Object.fromEntries(it.locations.filter((l) => l.colors).map((l) => [l.placement, l.colors!])),
          });
    add.addEventListener('click', async () => {
      add.disabled = true;
      try {
        for (const it of e.items) await toCart(it);
        add.textContent = 'Added ✓';
        bubble('assistant', 'Added to your cart.');
      } catch (err) {
        add.disabled = false;
        bubble('assistant', err instanceof Error ? err.message : 'Could not add to the cart.');
      }
    });
    actions.append(pay, add);
    card.append(actions);
    // See and adjust the designs on the real product preview (moves within the printable area).
    if (art.length) for (const it of e.items.filter((x) => x.slug && x.locations.some((l, li) => artFor(l, li)))) {
      const see = el('button', 'btn-quiet h-10 text-[13.5px] w-full', e.items.length > 1 ? `See it on the ${(it.name || it.productName || it.style).slice(0, 30)}` : 'See it on the product & adjust');
      see.type = 'button';
      see.addEventListener('click', async () => {
        see.disabled = true;
        try { const c = await toCart(it); location.href = `/catalog/${it.slug}/?edit=${encodeURIComponent(c.id)}`; }
        catch (err) { see.disabled = false; bubble('assistant', err instanceof Error ? err.message : 'Could not open the preview.'); }
      });
      card.append(see);
    }
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

  // Name, email and phone as Max heard them: the visitor checks (voice often mishears emails),
  // confirms once, and they fill checkout and the quote form from then on.
  function contactCard(heard: Contact) {
    const prev = getContact() || {};
    const box = el('div', 'rounded-2xl border border-violet-200 dark:border-violet-400/30 bg-violet-50/60 dark:bg-violet-500/10 p-3 grid gap-2');
    box.append(el('p', 'text-[11px] font-bold uppercase tracking-[0.12em] text-violet-700 dark:text-violet-300', 'Your details · please check'));
    const inputs: Record<string, HTMLInputElement> = {};
    for (const [k, label, type, ac] of [['name', 'Name', 'text', 'name'], ['email', 'Email', 'email', 'email'], ['phone', 'Phone', 'tel', 'tel']] as const) {
      const l = el('label', 'grid gap-1 text-[12px] font-semibold text-zinc-600 dark:text-zinc-300', label);
      const i = el('input', 'field !h-10 !text-[15px]'); i.type = type; i.name = k; i.autocomplete = ac;
      // Name and email can come from earlier visits; a phone number only if it was said now.
      i.value = (heard[k] || (k === 'phone' ? '' : prev[k]) || '').trim();
      // Spoken emails arrive as words: "ayden at tbsp dot la" → ayden@tbsp.la.
      if (k === 'email' && !i.value.includes('@')) i.value = i.value.replace(/\s+at\s+/i, '@').replace(/\s+dot\s+/gi, '.').replace(/\s+/g, '').toLowerCase();
      if (k === 'email') { i.inputMode = 'email'; i.autocapitalize = 'off'; i.spellcheck = false; }
      inputs[k] = i; l.append(i); box.append(l);
    }
    const err = el('p', 'text-[12.5px] font-medium text-red-600 dark:text-red-400'); err.hidden = true;
    const ok = el('button', 'btn-primary h-10 text-[14px]', 'Looks right'); ok.type = 'button';
    box.append(err, ok);
    ok.addEventListener('click', () => {
      const c = { name: inputs.name.value, email: inputs.email.value, phone: inputs.phone.value, company: prev.company };
      if (!c.name.trim()) { err.hidden = false; err.textContent = 'Please add your name.'; inputs.name.focus(); return; }
      if (!isEmail(c.email)) { err.hidden = false; err.textContent = 'That email doesn’t look right. Please fix it.'; inputs.email.focus(); return; }
      const saved = saveContact(c);
      box.replaceWith(contactLine(saved));
      void fetch(`${STUDIO_API}/api/public/max/contact`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, contact: saved }) }).catch(() => {});
      const note = `[details confirmed: name ${saved.name}, email ${saved.email}${saved.phone ? `, phone ${saved.phone}` : ''}]`;
      if (call) call.sendText(note); else ask('My details are confirmed.');
    });
    log.append(box); scroll();
    (inputs.email.value ? ok : inputs.name).focus({ preventScroll: true });
  }
  function contactLine(c: Contact) {
    const row = el('div', 'flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] muted');
    row.append(el('span', 'font-semibold text-emerald-600 dark:text-emerald-400', '✓ Details saved'), el('span', '', [c.name, c.email, c.phone].filter(Boolean).join(' · ')));
    const edit = el('button', 'font-semibold text-violet-700 dark:text-violet-300 hover:underline', 'Edit'); edit.type = 'button';
    edit.addEventListener('click', () => { row.remove(); contactCard(c); });
    const gone = el('button', 'font-semibold hover:underline', 'Forget me'); gone.type = 'button';
    gone.addEventListener('click', () => { row.remove(); forget(); });
    row.append(edit, gone);
    return row;
  }
  function forget() {
    forgetContact();
    bubble('assistant', 'Done, I’ve removed your details from this device.');
  }

  // Max put a design on a location. On that product's page it goes straight onto the live preview;
  // elsewhere a card shows it, and "See it on the product" opens the preview with it in place.
  /** Every design Max placed per product (location -> design), so "See it" brings them all. */
  const placedOn = new Map<string, Map<string, { a: (typeof art)[number]; method: string }>>();
  /** Product page, name and photo for an id: from products Max showed, else the site's index. */
  let index: Promise<Record<string, [string, string, string]>> | null = null;
  async function productInfo(pid: string) {
    const hit = seen.get(pid);
    if (hit) return hit;
    index ??= fetch('/max-products.json').then((r) => r.json()).catch(() => ({}));
    const x = (await index)[pid];
    return x ? { slug: x[0], name: x[1], image: x[2] } : undefined;
  }
  function placementCard(e: Extract<MaxEvent, { type: 'placement' }>) {
    const a = artById(e.artId) ?? (art.length === 1 ? art[0] : undefined);
    if (!a) return;
    const here = document.getElementById('add-to-quote')?.dataset;
    const pid = e.productId || here?.id || '';
    if (!placedOn.has(pid)) placedOn.set(pid, new Map());
    placedOn.get(pid)!.set(e.placement, { a, method: e.method });
    const what = `${e.placement} · ${e.method}${e.colors ? ` · ${e.colors} color${e.colors === 1 ? '' : 's'}` : ''}${e.widthIn ? ` · about ${Math.round(e.widthIn * 10) / 10}" wide` : ''}`;
    const card = el('div', 'flex items-center gap-3 rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-2.5');
    // A mid-gray backdrop keeps white and black designs visible until the product photo loads.
    const pic = el('div', 'relative w-16 h-16 shrink-0 rounded-xl bg-zinc-400/70 dark:bg-zinc-600 overflow-hidden');
    const artImg = a.url ? el('img', 'absolute inset-1.5 w-[calc(100%-0.75rem)] h-[calc(100%-0.75rem)] object-contain') : null;
    if (artImg) { artImg.src = a.url!; artImg.alt = ''; pic.append(artImg); }
    const info = el('div', 'min-w-0 flex-1 text-[13px] leading-snug');
    info.append(el('p', 'font-semibold text-zinc-900 dark:text-white truncate', a.file.name), el('p', 'muted', what));
    card.append(pic, info);
    log.append(card); scroll();
    if (here?.id && here.id === pid) {
      // On this product's page: place it on the preview right away.
      window.dispatchEvent(new CustomEvent('tbsp-max-place', { detail: { file: a.file, location: e.placement, method: e.method } }));
      info.append(el('p', 'text-emerald-700 dark:text-emerald-400 font-semibold', 'Placed on the preview. Close this chat to see it and adjust.'));
      return;
    }
    void productInfo(pid).then((prod) => {
      if (!prod) return;
      info.firstElementChild!.textContent = `${prod.name.slice(0, 40)} · ${a.file.name}`;
      // Product photos are fronts: the design sits on it only for front locations.
      if (prod.image && !/back|sleeve|neck|hood/i.test(e.placement)) {
        const g = el('img', 'absolute inset-0 w-full h-full object-contain bg-white'); g.src = prod.image; g.alt = '';
        pic.prepend(g);
        if (artImg) artImg.className = 'absolute left-1/2 top-[30%] w-[38%] -translate-x-1/2 object-contain drop-shadow';
      }
      if (!prod.slug) return;
      const see = el('button', 'btn-quiet btn-sm shrink-0', 'See it'); see.type = 'button';
      see.addEventListener('click', async () => {
        see.disabled = true;
        // Every design Max placed on this product goes along (front and back, say).
        const list: { key: string; name: string; type: string; location: string; method: string }[] = [];
        for (const [loc, x] of placedOn.get(pid)!) {
          const key = `max/${sessionId}/${x.a.id}`;
          await putFile(key, x.a.file);
          list.push({ key, name: x.a.file.name, type: x.a.file.type, location: loc, method: x.method });
        }
        try { sessionStorage.setItem('tbsp-max-place', JSON.stringify({ productId: pid, list })); } catch { /* ignore */ }
        location.href = `/catalog/${prod.slug}/`;
      });
      card.append(see);
    });
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
    onMic: () => { if (!liveOn) return false; if (call || calling) endCall(); else { setMode('voice'); void beginCall(); } return true; },
  });
  // Closing the panel stops him mid-sentence and hangs up.
  new MutationObserver(() => { if (sheet.hidden) { voice.stop(); endCall(); } }).observe(sheet, { attributes: true, attributeFilter: ['hidden'] });

  // Words common in what visitors say, by language (Max's admin voice language picks the list).
  const COMMON: Record<string, RegExp> = {
    en: /\b(i|i'm|im|my|me|we|our|you|the|a|an|to|for|and|on|in|with|of|need|want|like|can|do|is|it|yes|no|yeah|ok|okay|hi|hello|hey|bye|thanks|please|what|how|much|many|shirt|shirts|tee|tees|hoodie|hoodies|hat|hats|logo|print|front|back|black|white|price|order)\b/i,
    es: /\b(yo|mi|me|quiero|necesito|para|con|el|la|los|las|un|una|de|en|y|que|sí|si|no|hola|gracias|camisetas?|playeras?|sudaderas?|gorras?|logo)\b/i,
  };
  const soundsLikeSpeech = (t: string) => {
    const re = COMMON[voiceLang.slice(0, 2)];
    return !re || re.test(t) || /\d/.test(t) || t.trim().split(/\s+/).length >= 8;
  };
  /** A caption without the stretches that don't sound like speech (noise often comes as a few odd words before a real question). */
  const cleanCaption = (t: string) => {
    const re = COMMON[voiceLang.slice(0, 2)];
    if (!re) return t;
    const parts = t.split(/(?<=[,.!?])\s+/);
    const kept = parts.filter((p) => re.test(p) || /\d/.test(p));
    return kept.length ? kept.join(' ') : t;
  };

  // ── live call ──
  const callBar = sheet.querySelector<HTMLElement>('[data-max-call]')!;
  const callStatus = sheet.querySelector<HTMLElement>('[data-max-call-status]')!;
  const callOrb = sheet.querySelector<HTMLElement>('[data-max-call-orb]')!;
  const callMute = sheet.querySelector<HTMLButtonElement>('[data-max-call-mute]')!;
  const callCta = sheet.querySelector<HTMLButtonElement>('[data-max-call-cta]')!;
  const micBtn = sheet.querySelector<HTMLButtonElement>('[data-max-mic]')!;
  let liveOn = false;
  let calling = false;
  const queued: string[] = [];
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
  // Voice first: with "talk by default" on, the tap that opens Max starts the call (one tap, and the
  // browser counts it for the mic). Visitors who switch to chat or block the mic stay in chat.
  const MODE_KEY = 'tbsp-max-mode';
  const setMode = (m: 'voice' | 'chat') => { try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ } };
  const prefersChat = () => { try { return localStorage.getItem(MODE_KEY) === 'chat'; } catch { return false; } };
  let talkFirst = false;
  // "Talk to Max" buttons: always a call (or push-to-talk where calls aren't available).
  window.addEventListener('tbsp-max-talk', () => {
    if (liveOn) setMode('voice');
    openMax('');
    if (liveOn) { if (!call && !calling) void beginCall(); }
    else if (voice.canListen) voice.listen();
  });
  window.addEventListener('tbsp-max-open', () => { if (liveOn && talkFirst && !prefersChat() && !call && !calling) void beginCall(true); });
  sheet.querySelector('[data-max-to-chat]')?.addEventListener('click', () => {
    setMode('chat'); endCall();
    input.focus();
  });

  async function beginCall(auto = false) {
    if (calling || call) return;
    calling = true; voice.stop();
    intro.hidden = true; reset.hidden = false;
    paintCall(true); callStatus.textContent = 'Connecting…';
    callMute.setAttribute('aria-pressed', 'false');
    try {
      call = await startLiveCall(context, {
        status: (st, why) => {
          if (st === 'ended') {
            lastCallEnd = Date.now();
            call = null; calling = false; paintCall(false);
            if (why === 'time') bubble('assistant', 'Our call timed out. Tap the mic to talk again, or keep typing.');
            else if (why === 'bye') bubble('assistant', 'Call ended. I’m here anytime: tap the mic to talk, or just type.');
            else if (why === 'idle') bubble('assistant', 'I hung up since it got quiet. Tap the mic anytime to talk again, or keep typing.');
            else if (why === 'dropped') bubble('assistant', 'The call dropped. Tap the mic to talk again, or keep typing.');
            return;
          }
          callStatus.textContent = st === 'connecting' ? 'Connecting…' : st === 'talking' ? 'Max is talking…' : (call?.muted ? 'Muted' : 'Listening…');
          callOrb.classList.toggle('is-talking', st === 'talking');
        },
        caption: (who, text, done) => {
          if (!text) return;
          // Room noise sometimes transcribes as words in another language: don't show it as the visitor's message.
          if (who === 'user') text = cleanCaption(text);
          if (who === 'user' && !soundsLikeSpeech(text)) {
            if (done) { live.user?.remove(); delete live.user; }
            return;
          }
          // The same answer twice in a row (a repeated turn) shows once.
          if (who === 'assistant' && done && messages.at(-1)?.role === 'assistant' && messages.at(-1)!.content.trim() === text.trim()) {
            live.assistant?.remove(); delete live.assistant; return;
          }
          let b = live[who];
          if (!b) {
            b = live[who] = bubble(who, '');
            // The visitor's words can finish transcribing after Max starts answering: keep them above his reply.
            if (who === 'user' && live.assistant) live.assistant.before(b);
          }
          b.textContent = text; scroll();
          if (done) { delete live[who]; messages.push({ role: who, content: text }); save(); }
        },
        events: (evs) => { for (const ev of evs as MaxEvent[]) render(ev); },
      }, Date.now() - lastAt < 3 * 3600_000 ? messages.filter((m) => !queued.includes(m.content)) : [], () => queued.splice(0).join('\n'), Date.now() - lastCallEnd > 15 * 60_000);
      calling = false;
      for (const t of queued.splice(0)) call?.sendText(t);
    } catch (err) {
      calling = false; call = null; paintCall(false);
      // Anything typed while connecting still gets an answer, in the chat.
      const waiting = queued.splice(0).join('\n');
      if (waiting) void ask(waiting, true);
      const name = (err as Error)?.name;
      // Opened straight into a call that couldn't start: just stay in chat, ready to type.
      if (auto) { if (name === 'NotAllowedError') setMode('chat'); if (!waiting) input.focus(); return; }
      if (name === 'NotAllowedError') bubble('assistant', 'I can’t hear you because the microphone is blocked. Allow it in your browser’s site settings, or just type.');
      else if (name === 'NotFoundError') bubble('assistant', 'I can’t find a microphone on this device. You can type instead.');
      else if (voice.canListen) { bubble('assistant', 'My call line is busy right now, so speak after the beep and I’ll answer here.'); voice.listen(); }
      else bubble('assistant', 'My call line is busy right now. Type your message and I’ll answer here.');
      void (err instanceof LiveUnavailable);
    }
  }
  callCta.addEventListener('click', () => { setMode('voice'); void beginCall(); });
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
    if (ev.type === 'contact') contactCard(ev); else if (ev.type === 'forget') forget(); else if (ev.type === 'placement') placementCard(ev);
    else if (ev.type === 'products') productsCard(ev); else if (ev.type === 'cart') cartCard(ev); else if (ev.type === 'choices') choicesCard(ev); else if (ev.type === 'handoff') handoffCard(ev); else if (ev.type === 'error') bubble('assistant', ev.text);
  }

  /** `shown`: the message is already in the chat (typed while a call was connecting). */
  async function ask(text: string, shown = false) {
    text = text.trim();
    // On a call, typed text and tapped choices go to Max live.
    if (text && (call || calling)) {
      bubble('user', text); messages.push({ role: 'user', content: text }); save();
      // Still connecting: it goes over as soon as the call is up.
      if (call) call.sendText(text); else queued.push(text);
      return;
    }
    if (!text || busy) return;
    busy = true; send.disabled = true;
    intro.hidden = true; reset.hidden = false;
    if (!shown) { bubble('user', text); messages.push({ role: 'user', content: text }); save(); }
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
    voiceLang = voiceCfg?.lang || 'en-US';
    liveOn = !!(on && voiceCfg?.live && navigator.mediaDevices?.getUserMedia && 'WebSocket' in window && 'AudioWorkletNode' in window);
    // Talk by default: the chat opens on a big "Talk to Max" (one tap still starts it).
    talkFirst = !!voiceCfg?.talkByDefault;
    callCta.hidden = !(liveOn && talkFirst);
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
    try { localStorage.setItem('tbsp-max-reset-at', String(Date.now())); } catch { /* ignore */ }
    lastCallEnd = 0;
    voice.stop(); endCall(); messages = []; art.length = 0; artSeq = 0; sessionId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()); save();
    [...log.children].forEach((c) => { if (c !== intro) c.remove(); });
    filesBox.replaceChildren(); filesBox.hidden = true;
    intro.hidden = false; reset.hidden = true;
  });

  // Designs: each is checked here (colors, full color, size), shown above the box, and summarized to Max.
  function renderFiles() {
    filesBox.hidden = !art.length;
    filesBox.replaceChildren(...art.map((a) => {
      const chip = el('span', 'chip !h-9 !pl-1 !pr-1.5 gap-1.5 text-[12.5px]');
      if (a.url) { const t = el('img', 'w-7 h-7 rounded-md object-contain bg-zinc-400/70 dark:bg-zinc-600'); t.src = a.url; t.alt = ''; chip.append(t); } else chip.append(el('span', 'px-1', '📎'));
      chip.append(el('span', 'max-w-[9rem] truncate', a.file.name));
      const x = el('button', 'grid place-items-center w-6 h-6 rounded-full hover:bg-zinc-200 dark:hover:bg-white/10', '×'); x.type = 'button'; x.setAttribute('aria-label', `Remove ${a.file.name}`);
      x.addEventListener('click', () => { art.splice(art.indexOf(a), 1); if (a.url) URL.revokeObjectURL(a.url); renderFiles(); });
      chip.append(x);
      return chip;
    }));
  }

  // Logo: checked here (colors, full color, size) and summarized to Max.
  sheet.querySelector('[data-max-attach]')!.addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0]; fileIn.value = '';
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { bubble('assistant', 'That file is over 10 MB. Please send a smaller one, or email it to us.'); return; }
    if (art.length >= 6) { bubble('assistant', 'That’s 6 designs already. Remove one, or send the rest with your order.'); return; }
    const ink = await countInks(f).catch(() => ({ kind: 'unknown' }) as InkCount);
    const id = `a${++artSeq}`;
    art.push({ id, file: f, ink, url: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined });
    renderFiles();
    const summary = ink.kind === 'spot' ? `${ink.count} color${ink.count === 1 ? '' : 's'}` : ink.kind === 'full' ? 'full color' : 'file type I can’t preview';
    const low = ink.kind !== 'unknown' && !ink.vector && ink.widthPx && ink.widthPx < 1000 ? ', low resolution' : '';
    // On a call it's a note to Max; in the chat it reads as the visitor's message.
    if (call) { bubble('user', `📎 ${f.name}`); call.sendText(`[visitor uploaded design ${id}: ${f.name}, ${summary}${low}. Ask where it goes and how it should be decorated if that isn't clear yet.]`); }
    else ask(`Here's ${art.length > 1 ? 'another design' : 'my design'}: ${f.name} (${summary}${low}).`);
  });
}
