// Max's conversation in MaxSheet.astro. Messages stream from the studio (/api/public/max) as
// NDJSON events: text, products, cart, choices, handoff, done. Product and cart events render as
// cards; a cart can go straight to checkout (order-sheet.ts) or into the site cart.
// If the studio can't be reached, the visitor's message goes to the quote form instead.
import { track } from './analytics';
import { STUDIO_API, fetchPrices, money, type PriceItemInput, type PriceResponse } from './online';
import { openOrder, type OrderArtwork } from './order-sheet';
import { addToCart, cartItems, putFile, getFile } from './cart';
import { countInks, type InkCount } from '../components/design/colors';
import { business } from '../data/business';
import { openMax, reopenMax } from './max';
import { setupVoice, type VoiceConfig } from './max-voice';
import { renderOnProduct, type RenderResult } from './max-render';
import { startLiveCall, prefetchToken, LiveUnavailable } from './max-live';
import { getContact, saveContact, forgetContact, isEmail, type Contact } from './contact';

type Msg = { role: 'user' | 'assistant'; content: string };
interface CartLine extends Omit<PriceItemInput, 'locations'> {
  locations: (PriceItemInput['locations'][number] & { artId?: string })[];
  productId?: string; slug?: string; image?: string; why?: string; name?: string }
type MaxEvent =
  | { type: 'text'; delta: string }
  | { type: 'products'; items: { id: string; slug: string; name: string; brand?: string; style?: string; image?: string; why?: string }[] }
  | { type: 'cart'; items: CartLine[]; price?: PriceResponse; notes?: string[] | string }
  | { type: 'choices'; question?: string; options: { label: string; value: string }[] }
  | { type: 'handoff'; text?: string }
  | ({ type: 'contact' } & Contact)
  | { type: 'forget' }
  /** Max's own view of what's settled (products, colors, design, sizes, price, pay). */
  | { type: 'progress'; done: string[] }
  | { type: 'placement'; artId: string; productId?: string; placement: string; method: string; colors?: number; widthIn?: number }
  /** What Max just priced (product, color, sizes): the product page on screen follows it. */
  | { type: 'selection'; items: { productId: string; slug: string; color: string; sizes: Record<string, number> }[] }
  | { type: 'error'; text: string }
  | { type: 'done' };

const KEY = 'tbsp-max-v1';
const sheet = document.querySelector<HTMLElement>('[data-max-sheet]');
/** Set while the chat is open as the visitor leaves a page: the next page opens it again (this tab only). */
const OPEN_KEY = 'tbsp-max-open';

// Not inside the hidden product page that draws Max's mockups (max-render.ts): that copy must not touch the chat.
if (sheet && window.parent === window) {
  const log = sheet.querySelector<HTMLElement>('[data-max-log]')!;
  const intro = sheet.querySelector<HTMLElement>('[data-max-intro]')!;
  const form = sheet.querySelector<HTMLFormElement>('[data-max-form]')!;
  const input = sheet.querySelector<HTMLTextAreaElement>('#max-input')!;
  const send = sheet.querySelector<HTMLButtonElement>('[data-max-send]')!;
  const fileIn = sheet.querySelector<HTMLInputElement>('[data-max-file]')!;
  const filesBox = sheet.querySelector<HTMLElement>('[data-max-files]')!;
  const reset = sheet.querySelector<HTMLButtonElement>('[data-max-reset]')!;

  let messages: Msg[] = [];
  let savedArt: { id: string; name: string; type: string; ink: InkCount }[] = [];
  /** The order Max last proposed (products, colors, sizes, placements): kept and sent back so he never forgets it. */
  let order: CartLine[] = [];
  /** Cards Max showed (products, order, placements…) and how many messages came before each, so the next page shows them again. */
  let cards: { n: number; ev: MaxEvent }[] = [];
  /** Re-drawing saved cards: no page changes, analytics or saving. */
  let replaying = false;
  /** Max's typed reply is still streaming (a card shown now sits after it). */
  let replyOpen = false;
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
    if (saved?.messages?.length && (!saved.at || Date.now() - saved.at < 7 * 864e5)) { messages = saved.messages; sessionId = saved.sessionId; lastAt = saved.at || 0; savedArt = Array.isArray(saved.art) ? saved.art : []; order = Array.isArray(saved.order) ? saved.order : []; cards = Array.isArray(saved.cards) ? saved.cards : []; }
  } catch { /* ignore */ }
  if (!sessionId) sessionId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
  /** Max was open when the visitor left the last page (a minute ago at most): open him again here. */
  let carryOver: { at: number; call?: boolean } | null = null;
  try { carryOver = JSON.parse(sessionStorage.getItem(OPEN_KEY) || 'null'); sessionStorage.removeItem(OPEN_KEY); } catch { /* ignore */ }
  if (carryOver && !(Date.now() - carryOver.at < 60_000)) carryOver = null;
  /** Settles once a restored conversation is back on screen (anything added after it goes below). */
  let restored: Promise<unknown> = Promise.resolve();
  // Designs are kept too (files in the browser's file store), so reopening Max brings them back.
  // Voice calls: the studio only sees tool calls, so the transcript is sent along a few seconds
  // after each turn (and when the tab is left) to be saved with the chat (Admin › Max chats).
  let logTimer = 0, logPending = false;
  const sendLog = (beacon = false) => {
    window.clearTimeout(logTimer); logPending = false;
    const body = JSON.stringify({ sessionId, messages: messages.slice(-80), context: context() });
    const url = `${STUDIO_API}/api/public/max/log`;
    if (beacon && navigator.sendBeacon) { navigator.sendBeacon(url, body); return; }
    void fetch(url, { method: 'POST', body, keepalive: true }).catch(() => {});
  };
  const logSoon = () => {
    if (messages.filter((m) => m.role === 'user').length === 1 && !logPending && messages.at(-1)?.role === 'user') track('max_first_message', { mode: 'voice' });
    logPending = true; window.clearTimeout(logTimer); logTimer = window.setTimeout(() => sendLog(), 3000);
  };
  window.addEventListener('pagehide', () => { if (logPending) sendLog(true); });
  const save = () => {
    lastAt = Date.now();
    // Only the last 30 messages are kept: cards move with them.
    const drop = Math.max(0, messages.length - 30);
    const keptCards = cards.filter((c) => c.n >= drop).map((c) => ({ ...c, n: c.n - drop }));
    try { localStorage.setItem(KEY, JSON.stringify({ sessionId, messages: messages.slice(-30), at: lastAt, order, cards: keptCards, art: art.map((a) => ({ id: a.id, name: a.file.name, type: a.file.type, ink: a.ink })) })); } catch { /* ignore */ }
  };

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  };
  const scroll = () => requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  const bubble = (role: Msg['role'], text: string) => { const b = el('div', `max-bubble ${role === 'user' ? 'max-me' : 'max-bot'}`, text); log.append(b); scroll(); return b; };

  const resetAt = () => { try { return Number(localStorage.getItem('tbsp-max-reset-at')) || 0; } catch { return 0; } };
  /** When the last call ended. A welcome back needs 15 quiet minutes since the last message or call
   *  (lastAt is saved, so moving to another page mid-order doesn't count as a break). */
  let lastCallEnd = 0;
  /** When a call last dropped (a new call soon after is a reconnect). */
  let lastDropAt = 0;

  /** What Max should know about where the visitor is. */
  function context() {
    const path = location.pathname;
    const page = path === '/' ? 'home' : path.startsWith('/catalog/') && document.getElementById('add-to-quote') ? 'product' : path.startsWith('/quote-cart') ? 'cart' : path.startsWith('/catalog') ? 'catalog' : 'page';
    const f = document.getElementById('add-to-quote')?.dataset;
    const color = document.querySelector<HTMLElement>('.swatch[aria-checked="true"]')?.dataset.name;
    return {
      page, path, sessionId,
      ...(f?.id ? { product: { id: f.id, name: f.name, brand: f.brand, style: f.style, color } } : {}),
      // The order so far, so a reopened chat or a new call picks up exactly where it was.
      ...(order.length ? { order: order.map(({ image: _i, why: _w, ...x }) => x) } : {}),
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
      if (p.image) { const img = el('img', 'w-full aspect-[4/5] object-cover rounded-xl bg-[#f3f3f3]'); img.src = p.image; img.alt = ''; img.loading = 'lazy'; a.append(img); }
      a.append(el('span', 'text-[12.5px] font-semibold leading-snug text-zinc-900 dark:text-white line-clamp-2', p.name));
      if (p.why) a.append(el('span', 'text-[11.5px] muted leading-snug line-clamp-2', p.why));
      rail.append(a);
    }
    log.append(rail); scroll();
  }

  /** A cart line as the price/order APIs take it. */
  const forPrice = ({ productId: _a, slug: _b, image: _c, why: _d, name, ...x }: CartLine): PriceItemInput => ({ ...x, productName: x.productName || name });

  /** A short name for a product, for buttons: "tee", "hoodie", "hat"… */
  const kind = (name: string) => {
    const n = name.toLowerCase();
    // Bags first: brand names can contain "tee" (Q-Tees totes).
    return /tote/.test(n) ? 'tote' : /bag|backpack/.test(n) ? 'bag' : /hood/.test(n) ? 'hoodie' : /crew|sweatshirt/.test(n) ? 'sweatshirt' : /polo/.test(n) ? 'polo' : /tank/.test(n) ? 'tank' : /long sleeve/.test(n) ? 'long sleeve' : /beanie/.test(n) ? 'beanie' : /cap|hat|snapback|trucker/.test(n) ? 'hat' : /jacket/.test(n) ? 'jacket' : /t-shirt|\btee\b/.test(n) ? 'tee' : 'product';
  };
  function cartCard(e: Extract<MaxEvent, { type: 'cart' }>) {
    order = e.items; save();
    if (!replaying) followOnPage(e.items);
    // Only the newest order card stays open: earlier versions fold to one line, so the chat isn't a stack of carts.
    log.querySelectorAll<HTMLElement>('[data-max-cart]:not([data-old])').forEach((old) => {
      old.dataset.old = '';
      const line = el('button', 'text-left text-[12.5px] muted hover:underline', 'Earlier version of your order (tap to show)'); line.type = 'button';
      old.before(line); old.hidden = true;
      line.addEventListener('click', () => { old.hidden = !old.hidden; line.textContent = old.hidden ? 'Earlier version of your order (tap to show)' : 'Earlier version of your order (tap to hide)'; });
    });
    const card = el('div', 'rounded-2xl border border-violet-300/60 dark:border-violet-400/25 bg-violet-500/[0.05] p-3.5 grid gap-3');
    card.dataset.maxCart = '';
    card.append(el('p', 'text-[12px] font-bold uppercase tracking-[0.1em] text-violet-700 dark:text-violet-300', 'Your order, ready to go'));
    const pr = e.price && e.price.enabled ? e.price : null;
    // Each product with designs is drawn on its own page (hidden), like the preview there: the
    // card shows those mockups, and the cart and checkout carry them with the placed artwork.
    const renders: (Promise<RenderResult | null> | null)[] = e.items.map((it) => {
      // Size: the cart's, else what Max said when he placed it.
      const list = it.locations.flatMap((l, li) => { const a = artFor(l, li); return a ? [{ file: a.file, location: l.placement, method: l.method, widthIn: l.widthIn ?? placedOn.get(it.productId || '')?.get(l.placement)?.widthIn }] : []; });
      return it.slug && list.length ? renderOnProduct(it.slug, it.productId || '', it.color, list) : null;
    });
    e.items.forEach((it, i) => {
      const row = el('div', 'flex gap-3');
      const pics = el('div', 'shrink-0 flex gap-1');
      if (it.image) { const img = el('img', 'w-14 h-14 rounded-xl object-contain bg-white dark:bg-white/[0.06] border border-zinc-200/80 dark:border-white/10'); img.src = it.image; img.alt = ''; pics.append(img); }
      if (renders[i]) {
        pics.classList.add('animate-pulse');
        void renders[i]!.then((r) => {
          pics.classList.remove('animate-pulse');
          if (!r?.mockups.length) return;
          pics.replaceChildren(...r.mockups.map((m) => {
            const url = URL.createObjectURL(m.blob);
            // Tap to see it big.
            const link = el('a', 'block'); (link as HTMLAnchorElement).href = url; (link as HTMLAnchorElement).target = '_blank';
            const img = el('img', 'w-[72px] h-[84px] rounded-xl object-contain bg-white dark:bg-white/[0.06] border border-zinc-200/80 dark:border-white/10 hover:border-violet-400');
            img.src = url; img.alt = `${it.name || it.productName || ''} ${m.side} with your design`; img.title = `${m.side === 'back' ? 'Back' : 'Front'} · tap to enlarge`;
            link.append(img);
            return link;
          }));
        });
      }
      row.append(pics);
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
        line.append(el('span', '', `${l.placement}: ${l.method}${l.colors ? `, ${l.colors} color${l.colors === 1 ? '' : 's'}` : ''}${a && art.length > 1 ? ` · ${a.file.name.slice(0, 20)}` : ''}`));
        info.append(line);
      }
      if (it.artHelp) info.append(el('p', 'muted', `Design help: ${{ cleanup: 'art cleanup', layout: 'text or simple layout', custom: 'custom design' }[it.artHelp.type] ?? it.artHelp.type}`));
      if (it.why) info.append(el('p', 'mt-0.5 text-violet-700 dark:text-violet-300', it.why));
      row.append(info);
      const p = pr?.items[i];
      if (p) row.append(el('p', 'shrink-0 text-right text-[13px] font-semibold text-zinc-900 dark:text-white', p.ok ? money(p.subtotal + p.setup) : 'Quote'));
      card.append(row);
    });
    if (pr?.totals) {
      const t = pr.totals;
      // The lines above are products + setup; anything added on top (rush, design help) is listed so it adds up.
      const extra = (label: string, v?: number) => { if (!v) return; const r = el('div', 'flex items-baseline justify-between text-[13px] muted'); r.append(el('span', '', label), el('span', '', `+${money(v)}`)); card.append(r); };
      extra(`${t.turnaround === 'superrush' ? 'Super Rush' : 'Rush'}${t.rushPercent ? ` (+${t.rushPercent}%)` : ''}`, t.rush);
      extra('Design help', t.art);
      const tot = el('div', 'flex items-baseline justify-between border-t border-violet-300/40 pt-2 text-[14px]');
      tot.append(el('span', 'font-bold text-zinc-900 dark:text-white', 'Total before tax'), el('span', 'font-bold text-zinc-900 dark:text-white', money(t.subtotal + t.setup + (t.art || 0) + (t.rush || 0))));
      card.append(tot);
      if (t.readyBy) card.append(el('p', 'text-[12.5px] muted -mt-2', `Ready around ${new Date(t.readyBy).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} after proof approval.`));
    }
    card.append(el('p', 'text-[12.5px] muted', 'We send you a free proof first. Nothing prints until you approve it.'));
    // Notes come as a list or a single line (a string must not be split into letters).
    for (const n of ([] as string[]).concat(e.notes ?? []).filter(Boolean)) card.append(el('p', 'text-[12.5px] text-emerald-700 dark:text-emerald-400', n));
    const actions = el('div', 'grid grid-cols-2 gap-2');
    const pay = el('button', 'btn-primary h-11 text-[14px]', 'Order & pay');
    const add = el('button', 'btn-quiet h-11 text-[14px]', 'Add to cart');
    pay.type = add.type = 'button';
    const ok = !!pr?.totals && pr.items.every((x) => x.ok);
    pay.disabled = !ok;
    /** The order as it goes out (checkout or an emailed quote): items with each design's size and spot, the art files and the mockups. */
    async function prepare() {
      const done = await Promise.all(renders.map((r) => r ?? Promise.resolve(null)));
      const artwork: OrderArtwork[] = e.items.flatMap((it, i) => it.locations.flatMap((l, li) => { const a = artFor(l, li); return a ? [{ itemIndex: i, placement: l.placement, file: a.file }] : []; }));
      const mockups = done.flatMap((r, i) => (r?.mockups ?? []).map((m) => ({ itemIndex: i, side: m.side, blob: m.blob })));
      const placed = (i: number, place: string) => done[i]?.placements.find((p) => p.location.toLowerCase() === place.toLowerCase());
      const items = e.items.map((it, i) => ({ ...forPrice(it), locations: it.locations.map(({ artId: _a, ...l }) => { const p = placed(i, l.placement); return p ? { ...l, widthIn: p.widthIn, heightIn: p.heightIn, fromTopIn: p.fromTopIn, fromCenterIn: p.fromCenterIn, ...(p.notes ? { notes: p.notes } : {}) } : l; }) }));
      return { items, artwork, mockups };
    }
    pay.addEventListener('click', async () => {
      const res = await fetchPrices(e.items.map(forPrice));
      if (!res?.enabled || !res.totals || res.items.some((x) => !x.ok)) { bubble('assistant', 'Prices just changed, let me check again.'); return; }
      pay.disabled = true; const label = pay.textContent; pay.textContent = 'Preparing your designs…';
      const { items, artwork, mockups } = await prepare();
      pay.disabled = false; pay.textContent = label;
      steps.mark('pay');
      track('max_checkout_open', { value: res.totals.total, currency: 'USD' });
      const pieces = e.items.reduce((n, it) => n + Object.values(it.sizes).reduce((a, b) => a + b, 0), 0);
      openOrder({ items, artwork, mockups, price: res, summary: `${e.items.length} product${e.items.length === 1 ? '' : 's'} · ${pieces} pieces` });
    });
    /** One of Max's products as a cart item, with each location's design attached (placed on the product page). */
    const toCart = async (it: CartLine, r: RenderResult | null = null) => addToCart({
            productId: it.productId || '', slug: it.slug || '', name: it.name || it.productName || `${it.brand} ${it.style}`, brand: it.brand, style: it.style, cat: '', sub: '',
            image: it.image || '', url: it.slug ? `${location.origin}/catalog/${it.slug}/` : location.origin, color: it.color,
            sizeOrder: Object.keys(it.sizes), sizes: it.sizes,
            decorations: [...new Set(it.locations.map((l) => l.method))], locations: it.locations.map((l) => l.placement),
            placements: r?.placements.length ? r.placements : it.locations.flatMap((l, li) => {
              const a = artFor(l, li);
              return a ? [{ locId: '', location: l.placement, decoration: l.method, file: a.file.name, blob: a.file as Blob, widthIn: l.widthIn || 0, heightIn: l.heightIn || 0, fromTopIn: 0, fromCenterIn: 0, x: 0, y: 0, w: 0 }] : [];
            }),
            mockups: r?.mockups ?? [],
            inks: Object.fromEntries(it.locations.filter((l) => l.colors).map((l) => [l.placement, l.colors!])),
            ...(it.artHelp ? { artHelp: it.artHelp } : {}),
          });
    add.addEventListener('click', async () => {
      add.disabled = true;
      try {
        add.textContent = 'Adding…';
        for (const [i, it] of e.items.entries()) await toCart(it, renders[i] ? await renders[i] : null);
        add.textContent = 'Added ✓';
        bubble('assistant', 'Added to your cart.');
      } catch (err) {
        add.disabled = false;
        bubble('assistant', err instanceof Error ? err.message : 'Could not add to the cart.');
      }
    });
    actions.append(pay, add);
    card.append(actions);
    card.append(emailQuote(e, prepare));
    // See and adjust the designs on the real product preview (moves within the printable area).
    if (art.length) for (const it of e.items.filter((x) => x.slug && x.locations.some((l, li) => artFor(l, li)))) {
      const see = el('button', 'btn-quiet h-10 text-[13.5px] w-full', e.items.length > 1 ? `See the ${kind(it.name || it.productName || it.style)} & adjust` : 'See it on the product & adjust');
      see.type = 'button';
      see.addEventListener('click', async () => {
        see.disabled = true;
        try { const c = await toCart(it, renders[e.items.indexOf(it)] ? await renders[e.items.indexOf(it)] : null); location.href = `/catalog/${it.slug}/?edit=${encodeURIComponent(c.id)}`; }
        catch (err) { see.disabled = false; bubble('assistant', err instanceof Error ? err.message : 'Could not open the preview.'); }
      });
      card.append(see);
    }
    log.append(card); scroll();
  }

  /**
   * "Email me this quote": for buyers who need someone's OK first. Saved as a quote in the shop's admin
   * (Invoices & quotes) and emailed as a link. Asks for name and email here if Max doesn't have them yet.
   */
  function emailQuote(e: Extract<MaxEvent, { type: 'cart' }>, prepare: () => Promise<{ items: PriceItemInput[]; artwork: OrderArtwork[]; mockups: { itemIndex: number; side: string; blob: Blob }[] }>) {
    const box = el('div', 'grid gap-2');
    const open = el('button', 'btn-quiet h-11 text-[14px] w-full', '✉ Email me this quote');
    open.type = 'button';
    const form = el('form', 'grid gap-2 rounded-xl border border-zinc-200 dark:border-white/10 p-3'); form.hidden = true;
    const known = getContact();
    const name = el('input', 'field !h-10 !text-[15px]'); name.placeholder = 'Your name'; name.autocomplete = 'name'; name.value = known?.name || '';
    const email = el('input', 'field !h-10 !text-[15px]'); email.type = 'email'; email.placeholder = 'Email'; email.autocomplete = 'email'; email.value = known?.email || '';
    const send = el('button', 'btn-primary h-10 text-[14px]', 'Send me the quote'); send.type = 'submit';
    const msg = el('p', 'text-[12.5px]');
    form.append(el('p', 'text-[12.5px] muted', 'We save it and email you a link. Share it, or pay from it when you’re ready.'), name, email, send, msg);
    open.addEventListener('click', () => { open.hidden = true; form.hidden = false; (name.value ? email : name).focus(); });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!name.value.trim()) { msg.className = 'text-[12.5px] text-red-600'; msg.textContent = 'Please add your name.'; name.focus(); return; }
      if (!isEmail(email.value)) { msg.className = 'text-[12.5px] text-red-600'; msg.textContent = 'Please check your email.'; email.focus(); return; }
      send.disabled = true; send.textContent = 'Saving your quote…'; msg.textContent = '';
      try {
        const contact = saveContact({ ...(known ?? {}), name: name.value, email: email.value });
        const { items, artwork, mockups } = await prepare();
        const fd = new FormData();
        // Same turnaround as the card (Rush / Super Rush), so the emailed quote matches it.
        const turn = e.price && e.price.enabled ? e.price.totals?.turnaround : undefined;
        const turnaround = turn === 'superrush' ? 'super' : turn === 'rush' ? 'rush' : turn ? 'normal' : undefined;
        fd.set('data', JSON.stringify({ sessionId, contact, items, ...(turnaround ? { turnaround } : {}), note: ([] as string[]).concat(e.notes ?? []).join(' ') || undefined }));
        for (const a of artwork) fd.append(`art_${a.itemIndex}_${a.placement.slice(0, 40)}`, a.file, a.file.name);
        for (const m of mockups) fd.append(`mockup_${m.itemIndex}_${m.side}`, m.blob, `mockup-${m.itemIndex + 1}-${m.side}.png`);
        const r = await fetch(`${STUDIO_API}/api/public/max/quote`, { method: 'POST', body: fd }).then((x) => x.json().catch(() => null)).catch(() => null);
        if (!r?.ok) {
          // A product that needs a custom quote, or a field to fix: say so plainly.
          send.disabled = false; send.textContent = 'Send me the quote';
          msg.className = 'text-[12.5px] text-red-600';
          msg.textContent = r?.quoteOnly ? 'One of these products needs a custom quote. Our team will price it for you: tap the quote button or call us.' : r?.error || `Couldn't send it right now. Please try again, or call ${business.phoneDisplay}.`;
          if (r?.field === 'email') email.focus(); else if (r?.field === 'name') name.focus();
          return;
        }
        track('max_quote_emailed', { value: r.total, currency: 'USD' });
        form.replaceChildren(el('p', 'text-[13px] font-semibold text-emerald-700 dark:text-emerald-400', r.emailed === false ? `✓ Quote ${r.number ?? ''} saved. We'll email it to ${contact.email} shortly.` : `✓ Quote ${r.number ?? ''} sent to ${contact.email}. It's good for 14 days, and you can pay from it.`));
        if (r.url) { const a = el('a', 'text-[13px] font-semibold text-violet-700 dark:text-violet-300 hover:underline', 'Open the quote'); (a as HTMLAnchorElement).href = r.url; (a as HTMLAnchorElement).target = '_blank'; form.append(a); }
        if (call) call.sendText(`[quote ${r.number ?? ''} emailed to ${contact.email}]`);
      } catch {
        send.disabled = false; send.textContent = 'Send me the quote';
        msg.className = 'text-[12.5px] text-red-600'; msg.textContent = `Couldn't send it right now. Please try again, or call ${business.phoneDisplay}.`;
      }
    });
    box.append(open, form);
    return box;
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
      track('max_contact_saved');
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
  const placedOn = new Map<string, Map<string, { a: (typeof art)[number]; method: string; widthIn?: number }>>();
  /** Product page, name and photo for an id: from products Max showed, else the site's index. */
  let index: Promise<Record<string, [string, string, string]>> | null = null;
  async function productInfo(pid: string) {
    const hit = seen.get(pid);
    if (hit) return hit;
    index ??= fetch('/max-products.json').then((r) => r.json()).catch(() => ({}));
    const x = (await index)[pid];
    return x ? { slug: x[0], name: x[1], image: x[2] } : undefined;
  }
  const placementCards = new Map<string, { sig: string; el: HTMLElement }>();
  function placementCard(e: Extract<MaxEvent, { type: 'placement' }>) {
    const a = artById(e.artId) ?? (art.length === 1 ? art[0] : undefined);
    if (!a) return;
    // One card per design, product and spot: a repeat is skipped, a change replaces the old card.
    const key = `${a.id}|${e.productId || ''}|${e.placement.toLowerCase()}`;
    const sig = `${e.method}|${e.colors ?? ''}|${e.widthIn ?? ''}`;
    const prev = placementCards.get(key);
    if (prev?.sig === sig && prev.el.isConnected) return;
    prev?.el.remove();
    const here = document.getElementById('add-to-quote')?.dataset;
    const pid = e.productId || here?.id || '';
    if (!placedOn.has(pid)) placedOn.set(pid, new Map());
    placedOn.get(pid)!.set(e.placement, { a, method: e.method, widthIn: e.widthIn });
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
    placementCards.set(key, { sig, el: card });
    if (here?.id && here.id === pid) {
      // On this product's page: place it on the preview right away (a saved card shown again is already there).
      if (!replaying) window.dispatchEvent(new CustomEvent('tbsp-max-place', { detail: { file: a.file, location: e.placement, method: e.method, widthIn: e.widthIn } }));
      info.append(el('p', 'text-emerald-700 dark:text-emerald-400 font-semibold', 'Placed on the product on this page.'));
      return;
    }
    void productInfo(pid).then((prod) => {
      if (!prod) return;
      info.firstElementChild!.textContent = `${prod.name.slice(0, 40)} · ${a.file.name}`;
      // Product photos are fronts: the design sits on it only for front locations.
      // No catalog photo here: it's one stock color, which can contradict the color the visitor
      // chose. The design shows on its own; the order card's mockups show the chosen color.
      if (!prod.slug) return;
      const see = el('button', 'btn-quiet btn-sm shrink-0', 'See it'); see.type = 'button';
      see.addEventListener('click', () => { see.disabled = true; void showOnProduct(pid, prod.slug); });
      card.append(see);
    });
  }


  /**
   * Opens a product's page with every design Max placed on it (front and back, say), in the color and
   * sizes of Max's order, and the chat open again there with the whole conversation.
   */
  async function showOnProduct(pid: string, slug: string, pick?: { color?: string; sizes?: Record<string, number> }) {
    const list: { key: string; name: string; type: string; location: string; method: string; widthIn?: number }[] = [];
    for (const [loc, x] of placedOn.get(pid) ?? []) {
      const key = `max/${sessionId}/${x.a.id}`;
      await putFile(key, x.a.file);
      list.push({ key, name: x.a.file.name, type: x.a.file.type, location: loc, method: x.method, widthIn: x.widthIn });
    }
    // Designs on the order that weren't placed through a card yet (one design, Max's spots).
    const it = order.find((o) => o.productId === pid);
    if (it) for (const [li, l] of it.locations.entries()) {
      const a = artFor(l, li);
      if (!a || list.some((x) => x.location.toLowerCase() === l.placement.toLowerCase())) continue;
      const key = `max/${sessionId}/${a.id}`;
      await putFile(key, a.file);
      list.push({ key, name: a.file.name, type: a.file.type, location: l.placement, method: l.method, widthIn: l.widthIn });
    }
    const color = pick?.color || it?.color, sizes = pick?.sizes || it?.sizes;
    try { sessionStorage.setItem('tbsp-max-place', JSON.stringify({ productId: pid, list, color, sizes })); } catch { /* ignore */ }
    keepOpen();
    location.href = `/catalog/${slug}/`;
  }

  /**
   * What Max says matches the screen: on a product page, his order's color and sizes for that product
   * go onto the page. When he swaps the product the visitor is looking at for another one, that product's
   * page opens (after his reply, so it isn't cut off; on a call he offers a button so the call isn't dropped).
   */
  let switchTo: { pid: string; slug: string; name: string; color?: string; sizes?: Record<string, number> } | null = null;
  function followOnPage(items: { productId?: string; slug?: string; name?: string; productName?: string; color?: string; sizes?: Record<string, number> }[]) {
    const here = document.getElementById('add-to-quote')?.dataset;
    if (!here?.id || !items.length) return;
    const mine = items.find((it) => it.productId === here.id);
    if (mine) { window.dispatchEvent(new CustomEvent('tbsp-max-sync', { detail: { color: mine.color, sizes: mine.sizes } })); return; }
    // Only a clear swap (one product, not this one) moves the page.
    const next = items.length === 1 ? items[0] : null;
    if (!next?.productId || !next.slug) return;
    switchTo = { pid: next.productId, slug: next.slug, name: next.name || next.productName || 'product', color: next.color, sizes: next.sizes };
    if (call || calling) { const s = switchTo; switchTo = null; switchButton(s); }
  }
  function switchButton(s: NonNullable<typeof switchTo>) {
    const b = el('button', 'btn-quiet h-10 text-[13.5px] self-start', `Show the ${kind(s.name)} on the page`); b.type = 'button';
    b.addEventListener('click', () => { b.disabled = true; void showOnProduct(s.pid, s.slug, s); });
    log.append(b); scroll();
  }
  /** After a reply: open the product Max switched to. */
  function runSwitch() {
    const s = switchTo; switchTo = null;
    if (!s) return;
    bubble('assistant', `Opening the ${kind(s.name)} for you…`);
    window.setTimeout(() => void showOnProduct(s.pid, s.slug, s), 900);
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
  // Get the call token ready while the visitor reaches for a Max button (saves a second or two).
  const warm = (e: Event) => { if (liveOn && !call && !calling && (e.target as Element)?.closest?.('[data-max-open],[data-hero-talk],[data-max-call-cta],[data-max-mic],[data-search-max],[data-ask-ai]')) prefetchToken(context); };
  document.addEventListener('pointerover', warm, { passive: true });
  document.addEventListener('focusin', warm);
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
      track('max_call_start');
      call = await startLiveCall(context, {
        status: (st, why) => {
          if (st === 'ended') {
            lastCallEnd = Date.now();
            call = null; calling = false; paintCall(false);
            if (why === 'time') bubble('assistant', 'Our call timed out. Tap the mic to talk again, or keep typing.');
            else if (why === 'bye') bubble('assistant', 'Call ended. I’m here anytime: tap the mic to talk, or just type.');
            else if (why === 'idle') bubble('assistant', 'I hung up since it got quiet. Tap the mic anytime to talk again, or keep typing.');
            else if (why === 'dropped') { lastDropAt = Date.now(); }
            if (why === 'dropped') bubble('assistant', 'The call dropped. Tap the mic to talk again, or keep typing.');
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
          if (done) { delete live[who]; messages.push({ role: who, content: text }); save(); trackText(text, who); logSoon(); }
          if (done && who === 'assistant' && switchTo) { const s = switchTo; switchTo = null; switchButton(s); }
        },
        events: (evs) => { for (const ev of evs as MaxEvent[]) render(ev); },
      }, Date.now() - lastAt < 2 * 3600_000 ? messages.filter((m) => !queued.includes(m.content)) : [], () => queued.splice(0).join('\n'), Date.now() - lastDropAt < 2 * 60_000 ? 'reconnected' : Date.now() - Math.max(lastAt, lastCallEnd) > 15 * 60_000 ? 'welcome' : 'quiet');
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

  // ── progress row: Products › Colors › Design › Sizes › Price › Pay ──
  const stepRow = sheet.querySelector<HTMLElement>('[data-max-steps]');
  const steps = {
    done: new Set<string>(),
    mark(...names: string[]) {
      for (const n of names) this.done.add(n);
      if (!stepRow) return;
      stepRow.hidden = false;
      stepRow.querySelectorAll<HTMLElement>('[data-step]').forEach((li) => li.classList.toggle('is-done', this.done.has(li.dataset.step!)));
    },
    reset() { this.done.clear(); if (stepRow) { stepRow.hidden = true; stepRow.querySelectorAll('.is-done').forEach((li) => li.classList.remove('is-done')); } },
  };
  // The conversation settles steps before any card shows (colors said out loud, a size split agreed),
  // so Max's replies are read for them too. Steps only ever move forward.
  const COLOR = /\b(black|white|navy|red|royal|blue|grey|gray|heather|maroon|green|forest|kelly|yellow|gold|orange|pink|purple|brown|tan|sand|natural|cream|charcoal|olive|teal|aqua|burgundy|cardinal|silver)\b/i;
  function trackText(text: string, who: 'user' | 'assistant') {
    const t = text.toLowerCase();
    if (!steps.done.has('products')) return;
    if (COLOR.test(t)) steps.mark('colors');
    if (who === 'assistant' && /\b(small|medium|large|xl)\b.*\b(medium|large|xl|2xl)\b/.test(t)) steps.mark('sizes');
    if (who === 'assistant' && /(\$\d|\bdollars?\b)/.test(t) && /(total|subtotal|each|per)/.test(t)) steps.mark('price');
  }
  function trackSteps(ev: MaxEvent) {
    // Max's list adds to what's done; Pay only turns green when the visitor taps Order & pay.
    if (ev.type === 'progress') { steps.mark(...ev.done.map((d) => d.toLowerCase()).filter((d) => ['products', 'colors', 'design', 'sizes', 'price'].includes(d))); return; }
    if (ev.type === 'products') steps.mark('products');
    else if (ev.type === 'placement') steps.mark('products', 'design');
    else if (ev.type === 'cart') {
      steps.mark('products');
      if (ev.items.every((it) => it.color)) steps.mark('colors');
      if (ev.items.some((it) => it.locations.some((l, li) => artFor(l, li)))) steps.mark('design');
      if (ev.items.every((it) => Object.values(it.sizes).some((n) => n > 0))) steps.mark('sizes');
      if (ev.price && ev.price.enabled && ev.price.totals) { steps.mark('price'); if (!replaying) track('max_price_shown', { value: ev.price.totals.total, currency: 'USD' }); }
    }
  }

  /** Cards worth showing again on the next page (in place in the conversation). */
  const KEEP = new Set<MaxEvent['type']>(['products', 'cart', 'placement', 'choices', 'handoff', 'contact']);
  function render(ev: MaxEvent) {
    if (!replaying && KEEP.has(ev.type)) { cards.push({ n: messages.length + (replyOpen || live.assistant ? 1 : 0), ev }); cards = cards.slice(-40); save(); }
    if (ev.type === 'selection') { if (!replaying) followOnPage(ev.items); return; }
    trackSteps(ev);
    if (ev.type === 'contact') contactCard(ev); else if (ev.type === 'forget') forget(); else if (ev.type === 'placement') placementCard(ev);
    else if (ev.type === 'products') productsCard(ev); else if (ev.type === 'cart') cartCard(ev); else if (ev.type === 'choices') choicesCard(ev); else if (ev.type === 'handoff') handoffCard(ev); else if (ev.type === 'error') bubble('assistant', ev.text);
  }

  /** `shown`: the message is already in the chat (typed while a call was connecting). */
  async function ask(text: string, shown = false) {
    text = text.trim();
    // On a call, typed text and tapped choices go to Max live.
    if (text && (call || calling)) {
      bubble('user', text); messages.push({ role: 'user', content: text }); save(); trackText(text, 'user');
      // Still connecting: it goes over as soon as the call is up.
      if (call) call.sendText(text); else queued.push(text);
      return;
    }
    if (!text || busy) return;
    busy = true; send.disabled = true;
    intro.hidden = true; reset.hidden = false;
    if (!shown) { bubble('user', text); messages.push({ role: 'user', content: text }); save(); trackText(text, 'user'); }
    if (messages.filter((m) => m.role === 'user').length === 1) track('max_first_message', { mode: 'chat' });
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
          if (ev.type === 'text') { if (!out) out = bubble('assistant', ''); reply += ev.delta; replyOpen = true; out.textContent = reply; scroll(); }
          else { out = null; render(ev); }
        }
      }
      dots.remove();
      if (reply) { messages.push({ role: 'assistant', content: reply }); save(); voice.speak(reply); trackText(reply, 'assistant'); }
    } catch {
      dots.remove();
      // Max isn't reachable: the message still reaches the team through the quote form.
      const b = bubble('assistant', "I can't reach the shop right now. Send this to our team and we'll reply within one business day, or call us.");
      const row = el('div', 'flex flex-wrap gap-2');
      const q = el('a', 'btn-primary h-10 text-[13.5px]', 'Send as a quote request'); q.href = `/quick-quote/?details=${encodeURIComponent(text)}`;
      const c = el('a', 'btn-quiet h-10 text-[13.5px]', `Call ${business.phoneDisplay}`); c.href = `tel:${business.phone}`;
      row.append(q, c); b.after(row); scroll();
    } finally {
      busy = false; send.disabled = false; replyOpen = false;
      runSwitch();
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
    // A call was on when the visitor changed pages: one tap picks it up where it was.
    if (carryOver?.call && liveOn) void restored.then(() => {
      if (call || calling) return;
      const b = el('button', 'press self-start inline-flex items-center gap-2 h-10 px-4 rounded-full bg-violet-600 hover:bg-violet-700 text-white text-[13.5px] font-semibold', '🎙 Keep talking'); b.type = 'button';
      b.addEventListener('click', () => { b.remove(); setMode('voice'); void beginCall(); });
      log.append(b); scroll();
    });
    // The admin's opening line and tap-to-ask suggestions (Settings › Online orders › Max).
    if (greeting) sheet.querySelector('[data-max-greeting]')!.textContent = greeting;
    if (suggestions.length) {
      const box = sheet.querySelector<HTMLElement>('[data-max-starters]')!;
      // Keep the send-your-logo chip unless the admin already offers logo help.
      const logo = suggestions.some((t) => /logo/i.test(t)) ? null : box.querySelector('[data-max-logo]');
      const noLogo = [...box.querySelectorAll<HTMLElement>('[data-max-starter]')].find((b) => /^no logo/i.test(b.textContent || ''));
      box.replaceChildren(...suggestions.map((t) => { const b = el('button', 'chip !h-auto py-2 text-left text-[13.5px]', t); b.type = 'button'; b.dataset.maxStarter = ''; return b; }), ...(logo ? [logo] : []), ...(noLogo ? [noLogo] : []));
    }
    // Max-only buttons and sections show once he's confirmed on (see [data-max-only] in global.css).
    document.documentElement.dataset.max = on ? 'on' : 'off';
    void fab;
  })();

  // ── moving between pages ──
  // The chat follows the visitor: open when they leave a page means open on the next one, with the
  // conversation, the cards and the designs as they were. A voice call can't survive the page load,
  // so a "Keep talking" button picks it up with one tap (browsers need a tap for sound and mic).
  function keepOpen() { try { sessionStorage.setItem(OPEN_KEY, JSON.stringify({ at: Date.now(), call: !!(call || calling) })); } catch { /* ignore */ } }
  window.addEventListener('pagehide', () => {
    try { if (!sheet.hidden && sheet.hasAttribute('data-open')) keepOpen(); else sessionStorage.removeItem(OPEN_KEY); } catch { /* ignore */ }
  });

  /** Saved cards, back in their place in the conversation. Only the newest order card (older ones were folded away). */
  function replayChat() {
    const lastCart = cards.map((c) => c.ev.type).lastIndexOf('cart');
    let ci = 0;
    const cardsUpTo = (n: number) => {
      for (; ci < cards.length && cards[ci].n <= n; ci++) {
        const { ev, n: at } = cards[ci];
        if (ev.type === 'cart' && ci !== lastCart) continue;
        try {
          if (ev.type === 'contact') { const c = getContact(); if (c) log.append(contactLine(c)); }
          // A question already answered shows as text; the last one keeps its buttons.
          else if (ev.type === 'choices' && at < messages.length) { if (ev.question) bubble('assistant', ev.question); }
          else render(ev);
        } catch { /* a card that can't be drawn again is skipped */ }
      }
    };
    replaying = true;
    messages.forEach((m, i) => { cardsUpTo(i); bubble(m.role, m.content); });
    cardsUpTo(Infinity);
    replaying = false;
    return lastCart >= 0;
  }

  // Restore an earlier conversation in this tab.
  // A recent one continues; an older one (2+ hours) folds into one line and Max starts fresh.
  if (messages.length && Date.now() - lastAt < 2 * 3600_000) {
    intro.hidden = true; reset.hidden = false;
    if (carryOver) reopenMax();
    // The designs come back from the file store first, so the cards can show them.
    restored = Promise.all(savedArt.map(async (x) => {
      const blob = await getFile(`maxart/${sessionId}/${x.id}`).catch(() => null);
      if (!blob) return;
      const file = new File([blob], x.name, { type: x.type || blob.type });
      art.push({ id: x.id, file, ink: x.ink, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined });
      artSeq = Math.max(artSeq, Number(x.id.replace(/\D/g, '')) || 0);
    })).then(() => {
      art.sort((a, b) => a.id.localeCompare(b.id)); renderFiles();
      const hadCart = replayChat();
      if (order.length && !hadCart) {
        const again = el('button', 'chip !h-auto py-2 self-start text-[13.5px]', '↻ Show my order again'); again.type = 'button';
        again.addEventListener('click', () => { again.remove(); void ask('Please show my order again.'); });
        log.append(again);
      }
      scroll();
    });
  }
  else if (messages.length) {
    const old = el('details', 'rounded-xl border border-zinc-200/80 dark:border-white/10 px-3 py-2 text-[13px]');
    const when = lastAt ? new Date(lastAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
    old.append(el('summary', 'cursor-pointer muted', `Earlier conversation${when ? ` · ${when}` : ''}`));
    const inner = el('div', 'mt-2 flex flex-col gap-2');
    for (const m of messages) inner.append(el('div', `max-bubble ${m.role === 'user' ? 'max-me' : 'max-bot'}`, m.content));
    old.append(inner);
    log.prepend(old);
    messages = []; order = []; cards = []; savedArt = []; sessionId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()); save();
  }

  // The product page placed Max's design (here, or carried over from another page): its mockup shows in
  // the chat, so on a phone the visitor sees it without closing Max.
  let shownCard: HTMLElement | null = null;
  window.addEventListener('tbsp-max-shown', (e) => {
    const x = (e as CustomEvent<{ mockups: { side: string; blob: Blob }[]; name: string; color: string; locations: string[]; carried: boolean }>).detail;
    void restored.then(() => {
      if (!x) return;
      if (x.carried) {
        // Arrived from the chat: Max says where things stand, and he knows it on the next turn.
        const text = `Here it is on the ${x.name}${x.color ? ` in ${x.color}` : ''}${x.locations.length ? `, ${x.locations.join(' and ').toLowerCase()}` : ''}. You can move or resize it on the page, or keep telling me what to change.`;
        bubble('assistant', text); messages.push({ role: 'assistant', content: text }); save();
      }
      if (!x.mockups?.length) { scroll(); return; }
      shownCard?.remove();
      const card = shownCard = el('div', 'rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-2.5 grid gap-2');
      const pics = el('div', 'flex gap-2');
      for (const m of x.mockups) {
        const img = el('img', 'w-28 h-32 rounded-xl object-contain bg-white dark:bg-white/[0.06] border border-zinc-200/80 dark:border-white/10');
        img.src = URL.createObjectURL(m.blob); img.alt = `${x.name} ${m.side} with your design`;
        pics.append(img);
      }
      card.append(el('p', 'text-[12px] font-bold uppercase tracking-[0.1em] text-violet-700 dark:text-violet-300', 'On the page now'), pics);
      // Phones: the chat covers the page, so one tap shows it (the orb brings Max back).
      const look = el('button', 'btn-quiet h-10 text-[13.5px] md:hidden', 'Adjust it on the page'); look.type = 'button';
      look.addEventListener('click', () => sheet.querySelector<HTMLElement>('[data-sheet-close]:not([data-sheet-backdrop])')?.click());
      card.append(look);
      log.append(card); scroll();
    });
  });

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
    // Start over means a clean slate: no messages, designs, placements or pending text, and a new session for Max.
    voice.stop(); endCall(); steps.reset(); messages = []; art.length = 0; artSeq = 0; queued.length = 0; lastDropAt = 0;
    placedOn.clear(); placementCards.clear(); seen.clear(); order = []; cards = []; switchTo = null; shownCard = null;
    sessionId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()); save();
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
      x.addEventListener('click', () => { art.splice(art.indexOf(a), 1); if (a.url) URL.revokeObjectURL(a.url); renderFiles(); save(); });
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
    void putFile(`maxart/${sessionId}/${id}`, f).then(save).catch(() => {});
    renderFiles();
    const summary = ink.kind === 'spot' ? `${ink.count} color${ink.count === 1 ? '' : 's'}` : ink.kind === 'full' ? 'full color' : 'file type I can’t preview';
    const low = ink.kind !== 'unknown' && !ink.vector && ink.widthPx && ink.widthPx < 1000 ? ', low resolution' : '';
    // On a call it's a note to Max; in the chat it reads as the visitor's message.
    if (call) { bubble('user', `📎 ${f.name}`); call.sendText(`[visitor uploaded design ${id}: ${f.name}, ${summary}${low}. Ask where it goes and how it should be decorated if that isn't clear yet.]`); }
    else ask(`Here's ${art.length > 1 ? 'another design' : 'my design'}: ${f.name} (${summary}${low}).`);
  });
}
