// Shared behaviour for the mobile sheets (search, menu drawer, filters):
// dialog semantics, body scroll lock, focus trap + restore, Escape and
// backdrop to close, and swipe-down to close on bottom sheets.
//
// Markup contract: the sheet root is hidden with the `hidden` attribute/class
// until opened; it gets `data-open` one frame after it is shown so CSS can
// animate it in. Elements with [data-sheet-close] inside it close it.

type Opts = { onClose?: () => void; focus?: HTMLElement | null };
type State = { prev: Element | null; opts: Opts };
const open = new Map<HTMLElement, State>();
let lockY = 0;

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const lock = () => {
  if (document.documentElement.classList.contains('sheet-lock')) return;
  lockY = scrollY;
  document.documentElement.classList.add('sheet-lock');
  document.body.style.top = `-${lockY}px`;
};
const unlock = () => {
  if (open.size) return;
  document.documentElement.classList.remove('sheet-lock');
  document.body.style.top = '';
  // `scroll-behavior: smooth` on <html> would animate this jump.
  window.scrollTo({ top: lockY, behavior: 'instant' as ScrollBehavior });
};

export function isSheetOpen(el: HTMLElement) { return open.has(el); }

export function openSheet(el: HTMLElement, opts: Opts = {}) {
  if (open.has(el)) return;
  open.set(el, { prev: document.activeElement, opts });
  el.hidden = false;
  el.classList.remove('hidden');
  lock();
  requestAnimationFrame(() => requestAnimationFrame(() => el.setAttribute('data-open', '')));
  const target = opts.focus ?? el.querySelector<HTMLElement>('[autofocus],[data-sheet-focus]') ?? el.querySelector<HTMLElement>(FOCUSABLE);
  // Focus synchronously so iOS raises the keyboard inside the tap gesture.
  target?.focus({ preventScroll: true });
}

export function closeSheet(el: HTMLElement) {
  const st = open.get(el);
  if (!st) return;
  open.delete(el);
  el.removeAttribute('data-open');
  const panel = el.querySelector<HTMLElement>('[data-sheet-panel]');
  if (panel) panel.style.transform = '';
  // Sheets that are a normal panel on desktop ([data-sheet-persist]) stay in the DOM.
  const done = () => { if (!open.has(el) && !('sheetPersist' in el.dataset)) el.hidden = true; };
  if (reduced()) done(); else setTimeout(done, 260);
  unlock();
  st.opts.onClose?.();
  (st.prev as HTMLElement | null)?.focus?.({ preventScroll: true });
}

/** Wire close buttons, Escape, focus trap and swipe-down for one sheet root. */
export function wireSheet(el: HTMLElement) {
  if (el.dataset.sheetWired) return;
  el.dataset.sheetWired = '1';
  el.querySelectorAll('[data-sheet-close]').forEach((b) => b.addEventListener('click', () => closeSheet(el)));
  el.addEventListener('keydown', (e) => {
    if (!open.has(el)) return;
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(el); return; }
    if (e.key !== 'Tab') return;
    const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  // Swipe down on the grab handle / header to dismiss a bottom sheet.
  const panel = el.querySelector<HTMLElement>('[data-sheet-panel]');
  const grip = el.querySelector<HTMLElement>('[data-sheet-grip]');
  if (panel && grip) {
    let y0 = 0, dy = 0, dragging = false;
    grip.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; dy = 0; dragging = true; panel.style.transition = 'none'; }, { passive: true });
    grip.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      panel.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      panel.style.transition = '';
      if (dy > 90) closeSheet(el); else panel.style.transform = '';
    };
    grip.addEventListener('touchend', end);
    grip.addEventListener('touchcancel', end);
  }
}
