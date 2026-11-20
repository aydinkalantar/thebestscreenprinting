// Address autofill for the checkout's shipping address, through the studio (GET /api/public/address),
// so no key lives on the website and every shop's site gets it:
// - street suggestions while typing (Google, when the studio has its key); picking one fills the rest
// - a full ZIP fills an empty city and state (always on)
// Off or offline, the fields stay plain inputs with the browser's own autofill.
// One session id per address keeps Google's billing at one "session" per address picked.

import { STUDIO_API } from './online';

const API = `${STUDIO_API}/api/public/address`;

interface Suggestion { id: string; main: string; secondary: string }
export interface PickedAddress { street: string; city: string; state: string; zip: string }

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Suggestions, or null when the studio has street suggestions off. */
async function suggest(input: string, session: string, signal: AbortSignal): Promise<Suggestion[] | null> {
  const res = await fetch(`${API}?q=${encodeURIComponent(input)}&s=${encodeURIComponent(session)}`, { signal });
  if (!res.ok) throw new Error(`address ${res.status}`);
  const data = (await res.json()) as { on?: boolean; suggestions?: Suggestion[] };
  return data.on === false ? null : data.suggestions || [];
}

async function details(id: string, session: string): Promise<PickedAddress | null> {
  const res = await fetch(`${API}?place=${encodeURIComponent(id)}&s=${encodeURIComponent(session)}`);
  if (!res.ok) return null;
  return ((await res.json()) as { address: PickedAddress | null }).address;
}

/** City and state for a 5-digit ZIP, or null. */
export async function lookupZip(zip: string): Promise<{ city: string; state: string } | null> {
  const z = zip.trim().match(/^\d{5}$/)?.[0];
  if (!z) return null;
  try {
    const d = (await (await fetch(`${API}?zip=${z}`)).json()) as { city: string | null; state: string | null };
    return d.city && d.state ? { city: d.city, state: d.state } : null;
  } catch { return null; }
}

/** Turns a street input into a suggest-as-you-type field. `onPick` fills the other fields. */
export function attachAddressAutocomplete(input: HTMLInputElement, onPick: (a: PickedAddress) => void) {
  if (input.dataset.ac) return;
  input.dataset.ac = '1';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  const list = document.createElement('ul');
  list.id = `${input.name}-suggestions`;
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  list.className = 'absolute z-20 left-0 right-0 top-full mt-1 max-h-72 overflow-auto rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#15151d] shadow-xl py-1';
  input.setAttribute('aria-controls', list.id);
  const wrap = input.parentElement!;
  wrap.classList.add('relative');
  wrap.append(list);

  let session = uuid();
  let timer = 0;
  let ctl: AbortController | null = null;
  let items: Suggestion[] = [];
  let active = -1;
  let broken = false;

  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
  const highlight = (i: number) => {
    active = i;
    [...list.children].forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
    if (i >= 0) input.setAttribute('aria-activedescendant', `${list.id}-${i}`); else input.removeAttribute('aria-activedescendant');
  };
  const pick = async (s: Suggestion) => {
    close();
    input.value = s.main;
    const a = await details(s.id, session).catch(() => null);
    session = uuid();
    if (a) onPick(a);
  };
  const render = () => {
    list.replaceChildren();
    items.forEach((s, i) => {
      const li = document.createElement('li');
      li.id = `${list.id}-${i}`;
      li.setAttribute('role', 'option');
      li.className = 'px-3.5 py-2 cursor-pointer text-[14px] leading-snug aria-selected:bg-violet-500/10 hover:bg-zinc-100 dark:hover:bg-white/[0.06]';
      const b = document.createElement('b'); b.className = 'font-semibold text-zinc-900 dark:text-white'; b.textContent = s.main;
      const span = document.createElement('span'); span.className = 'block text-[12.5px] muted'; span.textContent = s.secondary;
      li.append(b, span);
      li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(s); });
      list.append(li);
    });
    const google = document.createElement('li');
    google.className = 'px-3.5 pt-1.5 pb-1 text-[11px] muted text-right';
    google.textContent = 'Address suggestions by Google';
    list.append(google);
    list.hidden = !items.length;
    input.setAttribute('aria-expanded', String(!!items.length));
    highlight(-1);
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (broken || q.length < 4) { close(); return; }
    timer = window.setTimeout(async () => {
      ctl?.abort();
      ctl = new AbortController();
      try { const r = await suggest(q, session, ctl.signal); if (r === null) { broken = true; close(); return; } items = r; render(); } catch (e) { if ((e as Error).name !== 'AbortError') { broken = true; close(); } }
    }, 250);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight(Math.min(items.length - 1, active + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(-1, active - 1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(items[active]); }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
}
