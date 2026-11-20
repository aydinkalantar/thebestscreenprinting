// Shared behaviour for the mobile sheets (search, menu drawer, filters):
// dialog semantics, body scroll lock, focus trap + restore, Escape and
// backdrop to close, and swipe-down to close on bottom sheets.
//
// Markup contract: the sheet root is hidden with the `hidden` attribute/class
// until opened; it gets `data-open` one frame after it is shown so CSS can
// animate it in. Elements with [data-sheet-close] inside it close it.
//
// Back button: a modal sheet adds one history entry when it opens, so the phone's Back button
// (or the browser's) closes the sheet instead of leaving the page, like any shop app. Closing it
// with X / Escape / swipe takes that entry back off.

/** `modal: false`: the page stays scrollable and usable behind it (Max's panel on desktop). */
type Opts = { onClose?: () => void; focus?: HTMLElement | null; modal?: boolean };
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
  if ([...open.values()].some((s) => s.opts.modal !== false)) return;
  document.documentElement.classList.remove('sheet-lock');
  document.body.style.top = '';
  // `scroll-behavior: smooth` on <html> would animate this jump.
  window.scrollTo({ top: lockY, behavior: 'instant' as ScrollBehavior });
};

// ── Back button ────────────────────────────────────────────────────────────────
/** Sheets that added a history entry, oldest first. */
const pushed: HTMLElement[] = [];
/** history.back() calls of our own whose popstate is not a Back press. */
let ownBacks = 0;
/** A link inside a sheet is taking the visitor to another page: keep the history as it is. */
let leaving = false;

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (ownBacks > 0) { ownBacks--; return; }
    const top = pushed.pop();
    if (top) closeSheet(top);
  });
  // A click on a link to another page from inside a sheet: the sheet closes, the page changes,
  // and the sheet's entry stays (going Back from there returns to this page).
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || !pushed.length || !pushed.some((s) => s.contains(a))) return;
    const to = new URL(a.href, location.href);
    if (to.pathname === location.pathname && to.search === location.search) return; // same page (#anchor)
    leaving = true;
    setTimeout(() => { leaving = false; }, 0);
  }, true);
}

const pushEntry = (el: HTMLElement) => {
  try { history.pushState({ ...(history.state || {}), sheet: el.id || true }, ''); pushed.push(el); } catch { /* ignore */ }
};
const dropEntry = (el: HTMLElement) => {
  const i = pushed.indexOf(el);
  if (i < 0) return;
  pushed.splice(i, 1);
  if (leaving) return;
  ownBacks++;
  history.back();
};

export function isSheetOpen(el: HTMLElement) { return open.has(el); }

export function openSheet(el: HTMLElement, opts: Opts = {}) {
  if (open.has(el)) return;
  open.set(el, { prev: document.activeElement, opts });
  el.hidden = false;
  el.classList.remove('hidden');
  if (opts.modal !== false) { lock(); pushEntry(el); }
  requestAnimationFrame(() => requestAnimationFrame(() => el.setAttribute('data-open', '')));
  const target = opts.focus ?? el.querySelector<HTMLElement>('[autofocus],[data-sheet-focus]') ?? el.querySelector<HTMLElement>(FOCUSABLE);
  // Focus synchronously so iOS raises the keyboard inside the tap gesture.
  target?.focus({ preventScroll: true });
}

export function closeSheet(el: HTMLElement) {
  const st = open.get(el);
  if (!st) return;
  open.delete(el);
  dropEntry(el);
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
    if (e.key !== 'Tab' || open.get(el)!.opts.modal === false) return;
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
