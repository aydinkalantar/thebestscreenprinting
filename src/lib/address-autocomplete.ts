// Address suggestions while typing (Google Places API, New) for the checkout's shipping address.
// The key is a browser key limited to this site's domain (PUBLIC_GOOGLE_PLACES_KEY in .env);
// without it, or if Google can't be reached, the fields stay plain inputs with browser autofill.
// One session token per address keeps Google's billing at one "session" per address picked.

const KEY = import.meta.env.PUBLIC_GOOGLE_PLACES_KEY as string | undefined;
const API = 'https://places.googleapis.com/v1';

interface Suggestion { placeId: string; main: string; secondary: string }
export interface PickedAddress { street: string; city: string; state: string; zip: string }

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

async function suggest(input: string, session: string, signal: AbortSignal): Promise<Suggestion[]> {
  const res = await fetch(`${API}/places:autocomplete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': KEY! },
    body: JSON.stringify({ input, sessionToken: session, includedRegionCodes: ['us'], includedPrimaryTypes: ['street_address', 'premise', 'subpremise'] }),
    signal,
  });
  if (!res.ok) throw new Error(`places ${res.status}`);
  const data = (await res.json()) as { suggestions?: { placePrediction?: { placeId: string; structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } }; text?: { text: string } } }[] };
  return (data.suggestions || []).map((s) => s.placePrediction).filter(Boolean).map((p) => ({
    placeId: p!.placeId,
    main: p!.structuredFormat?.mainText?.text || p!.text?.text || '',
    secondary: p!.structuredFormat?.secondaryText?.text || '',
  }));
}

async function details(placeId: string, session: string): Promise<PickedAddress | null> {
  const res = await fetch(`${API}/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(session)}`, {
    headers: { 'X-Goog-Api-Key': KEY!, 'X-Goog-FieldMask': 'addressComponents' },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { addressComponents?: { longText: string; shortText: string; types: string[] }[] };
  const c = (t: string, short = false) => { const x = data.addressComponents?.find((a) => a.types.includes(t)); return x ? (short ? x.shortText : x.longText) : ''; };
  const street = [c('street_number'), c('route', true)].filter(Boolean).join(' ');
  return { street, city: c('locality') || c('sublocality') || c('postal_town') || c('administrative_area_level_3'), state: c('administrative_area_level_1', true), zip: c('postal_code') };
}

/** Turns a street input into a suggest-as-you-type field. `onPick` fills the other fields. */
export function attachAddressAutocomplete(input: HTMLInputElement, onPick: (a: PickedAddress) => void) {
  if (!KEY || input.dataset.ac) return;
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
    const a = await details(s.placeId, session).catch(() => null);
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
      try { items = await suggest(q, session, ctl.signal); render(); } catch (e) { if ((e as Error).name !== 'AbortError') { broken = true; close(); } }
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
