// Behaviour for <OrderSheet />: fills it from a price answer, re-prices when delivery changes,
// and sends the order (with artwork) to the studio, then goes to the card payment page.
import { fetchPrices, money, placeOrder, type PriceItemInput, type PriceResponse, type Totals } from './online';
import { openSheet, wireSheet } from './sheet';

export interface OrderArtwork { itemIndex: number; placement: string; file: File }
export interface OrderRequest { items: PriceItemInput[]; artwork: OrderArtwork[]; price: Extract<PriceResponse, { enabled: true }>; summary: string }

let wired = false;
let current: OrderRequest | null = null;
let totals: Totals | null = null;

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
  dl.replaceChildren();
  if (!totals || !current) return;
  row(dl, 'Products', money(totals.subtotal));
  if (totals.setup) row(dl, 'Setup / screens', money(totals.setup));
  row(dl, 'Shipping', totals.shipping ? money(totals.shipping) : 'Free');
  if (totals.tax) row(dl, `Tax (${totals.taxRate}%)`, money(totals.tax));
  row(dl, 'Total', money(totals.total), true);
  const pct = current.price.payment.depositPercent;
  el.querySelector('[data-os-full-amount]')!.textContent = `· ${money(totals.total)}`;
  el.querySelector('[data-os-deposit-amount]')!.textContent = `· ${pct}% now, ${money(Math.round(totals.total * pct) / 100)}`;
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
  const showMsg = (t: string) => { msg.className = 'rounded-xl px-4 py-3 text-sm font-medium bg-red-500/10 text-red-700 dark:text-red-300'; msg.textContent = t; msg.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
  const setErr = (field: string, t: string) => { const e = form.querySelector<HTMLElement>(`.err[data-for="${field}"]`); if (e) e.textContent = t; };

  form.addEventListener('change', async (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name !== 'delivery' || !current) return;
    address.hidden = t.value !== 'ship';
    const res = await fetchPrices(current.items, t.value as 'pickup' | 'ship');
    if (res?.enabled && res.totals) { totals = res.totals; renderTotals(el); }
  });

  let sending = false;
  const submit = async () => {
    if (sending || !current) return;
    form.querySelectorAll<HTMLElement>('.err').forEach((x) => { x.textContent = ''; });
    msg.className = 'hidden';
    const name = val('name'), email = val('email');
    const delivery = (form.querySelector<HTMLInputElement>('input[name="delivery"]:checked')?.value || 'pickup') as 'pickup' | 'ship';
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
      ...(delivery === 'ship' ? { address: { street: val('street'), city: val('city'), state: val('state'), zip: val('zip') } } : {}),
      notes: val('notes') || undefined, leadSource: val('leadSource') || undefined,
    }));
    for (const a of current.artwork) fd.append(`art_${a.itemIndex}_${a.placement.slice(0, 40)}`, a.file, a.file.name);
    sending = true;
    const label = send.querySelector('span')!;
    send.setAttribute('aria-busy', 'true'); send.setAttribute('aria-disabled', 'true');
    label.textContent = 'Creating your order…';
    const res = await placeOrder(fd);
    if (res.ok) {
      label.textContent = 'Opening secure payment…';
      location.href = res.checkoutUrl;
      return;
    }
    sending = false;
    send.removeAttribute('aria-busy'); send.removeAttribute('aria-disabled');
    label.textContent = 'Continue to secure payment';
    if (res.field) setErr(res.field === 'address' ? 'address' : res.field, res.error);
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
  current = req;
  totals = req.price.totals;
  const { delivery, payment } = req.price;
  el.querySelector('[data-os-summary]')!.textContent = req.summary;
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
  // Pickup vs shipping changes the total: price the choice that's selected.
  if (shipInput.checked) fetchPrices(req.items, 'ship').then((r) => { if (r?.enabled && r.totals) { totals = r.totals; renderTotals(el); } });
  openSheet(el);
}
