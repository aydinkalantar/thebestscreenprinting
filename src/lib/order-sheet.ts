// Behaviour for <OrderSheet />: fills it from a price answer, re-prices when delivery changes,
// and sends the order (with artwork) to the studio, then goes to the card payment page.
import { fetchPrices, money, placeOrder, type PriceItemInput, type PriceResponse, type Totals, type Turnaround } from './online';
import { prefillContact, saveContact } from './contact';
import { openSheet, wireSheet } from './sheet';
import { attachAddressAutocomplete } from './address-autocomplete';

export interface OrderArtwork { itemIndex: number; placement: string; file: File }
export interface OrderMockup { itemIndex: number; side: string; blob: Blob }
export interface OrderRequest { items: PriceItemInput[]; artwork: OrderArtwork[]; /** Product photos with the designs on them, per item and side. */ mockups?: OrderMockup[]; price: Extract<PriceResponse, { enabled: true }>; summary: string; /** Cart items being bought: removed on the thank-you page. */ cartIds?: string[] }

/** Remembered while the customer is at Stripe, so the thank-you page can tidy the cart. */
export const CHECKOUT_KEY = 'tbsp-checkout';

let wired = false;
let current: OrderRequest | null = null;
let totals: Totals | null = null;
/** Whether the studio prices turnaround (answers with totals.rush); until then only Normal is offered. */
let turnPriced = false;

const BUSINESS_DAYS: Record<Turnaround, number> = { normal: 10, rush: 5, superrush: 3 };
/** Rough ready date from today, skipping weekends, when the studio doesn't send one. */
function estimate(days: number) {
  const d = new Date();
  while (days > 0) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) days--; }
  return d;
}
const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

const sheet = () => document.getElementById('order-sheet');

function row(dl: HTMLElement, label: string, value: string, strong = false) {
  const dt = document.createElement('dt');
  dt.className = strong ? 'font-bold text-zinc-900 dark:text-white pt-1.5 border-t border-zinc-200 dark:border-white/10' : 'muted';
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.className = `text-right ${strong ? 'font-bold text-zinc-900 dark:text-white pt-1.5 border-t border-zinc-200 dark:border-white/10' : 'font-semibold text-zinc-900 dark:text-white'}`;
  dd.textContent = value;
  dl.append(dt, dd);
}

function renderTotals(el: HTMLElement) {
  const dl = el.querySelector<HTMLElement>('[data-os-totals]')!;
  const terr = el.querySelector<HTMLElement>('[data-os-turn-err]');
  if (terr) { terr.hidden = !totals?.turnaroundError; terr.textContent = totals?.turnaroundError || ''; }
  dl.replaceChildren();
  if (!totals || !current) return;
  row(dl, 'Products', money(totals.subtotal));
  if (totals.setup) row(dl, 'Setup / screens', money(totals.setup));
  if (totals.art) row(dl, 'Artwork help', money(totals.art));
  if (totals.rush) row(dl, `${totals.turnaround === 'superrush' ? 'Super Rush' : 'Rush'} fee${totals.rushPercent ? ` (+${totals.rushPercent}%)` : ''}`, money(totals.rush));
  const shipping = deliveryOf(el.querySelector<HTMLFormElement>('[data-os-form]')!) === 'ship';
  row(dl, shipping ? 'Shipping' : 'Pickup', totals.shipping ? money(totals.shipping) : 'Free');
  // The studio waives shipping over its free-shipping amount: the option says so once this order qualifies.
  if (shipping) el.querySelector('[data-os-ship-price]')!.textContent = `· ${totals.shipping ? money(totals.shipping) : 'free for this order'}`;
  if (totals.tax) row(dl, `Tax (${totals.taxRate}%)`, money(totals.tax));
  row(dl, 'Total', money(totals.total), true);
  const pct = current.price.payment.depositPercent;
  el.querySelector('[data-os-full-amount]')!.textContent = `· ${money(totals.total)}`;
  el.querySelector('[data-os-deposit-amount]')!.textContent = `· ${pct}% now, ${money(Math.round(totals.total * pct) / 100)}`;
}

/** The ship-to state, once chosen (Alaska, Hawaii and territories don't get free shipping). */
const stateOf = (form: HTMLFormElement) => ((form.elements.namedItem('state') as HTMLSelectElement | null)?.value || '').trim() || undefined;
const deliveryOf = (form: HTMLFormElement) => (form.querySelector<HTMLInputElement>('input[name="delivery"]:checked')?.value || 'pickup') as 'pickup' | 'ship';
const turnOf = (form: HTMLFormElement) => (form.querySelector<HTMLInputElement>('input[name="turnaround"]:checked')?.value || 'normal') as Turnaround;

const pieces = (items: PriceItemInput[]) => items.reduce((n, it) => n + Object.values(it.sizes).reduce((a, b) => a + b, 0), 0);
let turnDays: Partial<Record<Turnaround, number>> = {};

function setupTurnaround(el: HTMLElement, opts: import('./online').TurnaroundOptions | undefined, items: PriceItemInput[]) {
  const turn = el.querySelector<HTMLElement>('[data-os-turn]')!;
  turnPriced = !!opts && !!(opts.rush || opts.superrush);
  turn.hidden = !turnPriced;
  turnDays = {};
  if (!opts) return;
  const n = pieces(items);
  (['normal', 'rush', 'superrush'] as Turnaround[]).forEach((k) => {
    const o = (opts as Record<string, { days: number; percent?: number; maxPieces?: number } | undefined>)[k];
    const row = el.querySelector<HTMLElement>(`[data-os-turn-opt="${k}"]`)!;
    const input = row.querySelector('input')!;
    const tooMany = !!(o?.maxPieces && n > o.maxPieces);
    row.hidden = !o;
    input.disabled = !o || tooMany;
    if (o) {
      turnDays[k] = o.days;
      const meta = row.querySelector('[data-os-turn-meta]')!;
      meta.textContent = ` · ${o.days} business day${o.days === 1 ? '' : 's'}${o.percent ? ` · +${o.percent}%` : ''}${tooMany ? ` · up to ${o.maxPieces} pieces` : ''}`;
    }
    if ((!o || tooMany) && input.checked) (el.querySelector<HTMLInputElement>('[data-os-turn-opt="normal"] input')!).checked = true;
  });
}

/** Ready dates under each turnaround choice (the studio's date when it sends one for the selected option). */
function renderReady(el: HTMLElement) {
  el.querySelectorAll<HTMLElement>('[data-os-ready]').forEach((n) => {
    const k = n.dataset.osReady as Turnaround;
    const chosen = (el.querySelector<HTMLInputElement>('input[name="turnaround"]:checked')?.value || 'normal') === k;
    const date = chosen && totals?.readyBy ? new Date(totals.readyBy) : estimate(turnDays[k] ?? BUSINESS_DAYS[k] ?? 10);
    n.textContent = `Ready around ${fmtDate(date)} after proof approval`;
  });
}

function wire(el: HTMLElement) {
  if (wired) return;
  wired = true;
  wireSheet(el);
  const form = el.querySelector<HTMLFormElement>('[data-os-form]')!;
  const send = el.querySelector<HTMLButtonElement>('[data-os-send]')!;
  const msg = el.querySelector<HTMLElement>('[data-os-msg]')!;
  const address = el.querySelector<HTMLElement>('[data-os-address]')!;
  const val = (n: string) => ((form.elements.namedItem(n) as HTMLInputElement | null)?.value || '').trim();
  // Shipping address: Google suggestions while typing fill city, state and ZIP.
  const field = (n: string) => form.elements.namedItem(n) as HTMLInputElement | HTMLSelectElement;
  attachAddressAutocomplete(field('street') as HTMLInputElement, (a) => {
    if (a.street) field('street').value = a.street;
    if (a.city) field('city').value = a.city;
    // Re-priced for the state (free shipping is for the lower 48 only).
    if (a.state) { field('state').value = a.state; field('state').dispatchEvent(new Event('change', { bubbles: true })); }
    if (a.zip) field('zip').value = a.zip;
    (field('street2') as HTMLInputElement).focus();
  });
  const showMsg = (t: string) => { msg.className = 'rounded-xl px-4 py-3 text-sm font-medium bg-red-500/10 text-red-700 dark:text-red-300'; msg.textContent = t; msg.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
  const setErr = (field: string, t: string) => { const e = form.querySelector<HTMLElement>(`.err[data-for="${field}"]`); if (e) e.textContent = t; };

  form.addEventListener('change', async (e) => {
    const t = e.target as HTMLInputElement;
    if ((t.name !== 'delivery' && t.name !== 'turnaround' && t.name !== 'state') || !current) return;
    if (t.name === 'delivery') address.hidden = t.value !== 'ship';
    const res = await fetchPrices(current.items, deliveryOf(form), undefined, turnPriced ? turnOf(form) : undefined, stateOf(form));
    if (res?.enabled && res.totals) { totals = res.totals; renderTotals(el); renderReady(el); }
  });

  let sending = false;
  const submit = async () => {
    if (sending || !current) return;
    form.querySelectorAll<HTMLElement>('.err').forEach((x) => { x.textContent = ''; });
    msg.className = 'hidden';
    const name = val('name'), email = val('email');
    const delivery = deliveryOf(form);
    let bad = '';
    if (!name) { setErr('name', 'Please enter your name.'); bad ||= 'name'; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr('email', 'Enter a valid email for your receipt and proof.'); bad ||= 'email'; }
    if (delivery === 'ship' && !(val('street') && val('city') && val('state') && val('zip'))) { setErr('address', 'Please enter the full shipping address.'); bad ||= 'street'; }
    if (bad) { (form.elements.namedItem(bad) as HTMLInputElement | null)?.focus(); return; }
    const pay = (form.querySelector<HTMLInputElement>('input[name="pay"]:checked')?.value || current.price.payment.options[0]) as 'full' | 'deposit';
    const fd = new FormData();
    fd.set('data', JSON.stringify({
      contact: { name, email, phone: val('phone') || undefined, company: val('company') || undefined },
      items: current.items, delivery, pay,
      ...(delivery === 'ship' ? { address: { street: [val('street'), val('street2')].filter(Boolean).join(', '), city: val('city'), state: val('state'), zip: val('zip') } } : {}),
      notes: val('notes') || undefined, leadSource: val('leadSource') || undefined,
      ...(turnPriced ? { turnaround: turnOf(form) } : {}),
      returnUrl: location.href,
    }));
    for (const a of current.artwork) fd.append(`art_${a.itemIndex}_${a.placement.slice(0, 40)}`, a.file, a.file.name);
    for (const m of current.mockups ?? []) fd.append(`mockup_${m.itemIndex}_${m.side}`, m.blob, `mockup-${m.itemIndex + 1}-${m.side}.png`);
    sending = true;
    const label = send.querySelector('span')!;
    send.setAttribute('aria-busy', 'true'); send.setAttribute('aria-disabled', 'true');
    label.textContent = 'Creating your order…';
    const res = await placeOrder(fd);
    if (res.ok) {
      label.textContent = 'Opening secure payment…';
      saveContact({ name, email, phone: val('phone'), company: val('company') });
      try { localStorage.setItem(CHECKOUT_KEY, JSON.stringify({ orderNumber: res.orderNumber, email, cartIds: current.cartIds || [], at: Date.now() })); } catch { /* ignore */ }
      location.href = res.checkoutUrl;
      return;
    }
    sending = false;
    send.removeAttribute('aria-busy'); send.removeAttribute('aria-disabled');
    label.textContent = 'Continue to secure payment';
    if (res.field === 'turnaround') { const terr = el.querySelector<HTMLElement>('[data-os-turn-err]'); if (terr) { terr.hidden = false; terr.textContent = res.error; } }
    else if (res.field) setErr(res.field === 'address' ? 'address' : res.field, res.error);
    showMsg(res.invoiceUrl ? `${res.error} ` : res.error);
    if (res.invoiceUrl) {
      const a = document.createElement('a');
      a.href = res.invoiceUrl; a.className = 'underline font-semibold'; a.textContent = 'Open your invoice';
      msg.append(a);
    }
  };
  send.addEventListener('click', submit);
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
}

/** Opens the checkout for priced items. */
export function openOrder(req: OrderRequest) {
  const el = sheet();
  if (!el) return;
  wire(el);
  // Details the visitor already confirmed (with Max or a past order) are filled in.
  prefillContact(el.querySelector<HTMLFormElement>('[data-os-form]')!);
  current = req;
  totals = req.price.totals;
  const { delivery, payment } = req.price;
  el.querySelector('[data-os-summary]')!.textContent = req.summary;
  // What's being ordered, as pictures: each product with the designs on it.
  const pics = el.querySelector<HTMLElement>('[data-os-mockups]');
  if (pics) {
    pics.querySelectorAll('img').forEach((i) => URL.revokeObjectURL(i.src));
    pics.replaceChildren(...(req.mockups ?? []).map((m) => { const i = document.createElement('img'); i.src = URL.createObjectURL(m.blob); i.alt = `${m.side} mockup`; i.className = 'w-16 h-20 rounded-lg object-contain bg-white border border-zinc-200/80 dark:border-white/10'; return i; }));
    pics.style.display = req.mockups?.length ? 'flex' : 'none';
  }
  const pickup = el.querySelector<HTMLElement>('[data-os-pickup]')!;
  const ship = el.querySelector<HTMLElement>('[data-os-ship]')!;
  pickup.hidden = delivery.pickup == null;
  ship.hidden = delivery.shipping == null;
  el.querySelector('[data-os-pickup-note]')!.textContent = delivery.pickup || '';
  el.querySelector('[data-os-ship-price]')!.textContent = delivery.shipping != null ? `· ${delivery.shipping ? money(delivery.shipping) : 'free'}` : '';
  const pickupInput = pickup.querySelector('input')!, shipInput = ship.querySelector('input')!;
  if (!pickupInput.checked && !shipInput.checked) (delivery.pickup != null ? pickupInput : shipInput).checked = true;
  el.querySelector<HTMLElement>('[data-os-delivery]')!.hidden = delivery.pickup == null && delivery.shipping == null;
  el.querySelector<HTMLElement>('[data-os-address]')!.hidden = !shipInput.checked;
  const full = el.querySelector<HTMLElement>('[data-os-full]')!, dep = el.querySelector<HTMLElement>('[data-os-deposit]')!;
  full.hidden = !payment.options.includes('full');
  dep.hidden = !payment.options.includes('deposit');
  el.querySelector<HTMLElement>('[data-os-pay]')!.hidden = payment.options.length < 2;
  const fullIn = full.querySelector('input')!, depIn = dep.querySelector('input')!;
  if (!payment.options.includes(fullIn.checked ? 'full' : depIn.checked ? 'deposit' : ('' as 'full'))) (payment.options[0] === 'deposit' ? depIn : fullIn).checked = true;
  renderTotals(el);
  // Turnaround choices come from the studio (only the ones that are on, with their % and days).
  setupTurnaround(el, req.price.turnaround, req.items);
  const form = el.querySelector<HTMLFormElement>('[data-os-form]')!;
  if (deliveryOf(form) === 'ship' || turnPriced) fetchPrices(req.items, deliveryOf(form), undefined, turnPriced ? turnOf(form) : undefined, stateOf(form)).then((r) => { if (r?.enabled && r.totals) { totals = r.totals; renderTotals(el); renderReady(el); } });
  renderReady(el);
  openSheet(el);
}
