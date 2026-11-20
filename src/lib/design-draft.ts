// Product page drafts: what a visitor set up on a product (placed artwork, print spots, methods,
// color, sizes, ink colors, artwork help) is saved on this device as they go, so a refresh, a closed
// tab or a trip to another page brings it all back. The usual way stores keep a design in progress.
//
// Storage: one small JSON index in localStorage (per product slug, no files) and the artwork files in
// the quote cart's IndexedDB under `draft/<slug>/…` keys (src/lib/cart.ts, which leaves those keys
// alone). Drafts last 30 days; the 12 most recent products are kept. Every call is wrapped: without
// storage the page simply starts fresh, as before.
import type { DraftArt } from '../components/design/design';
import { DRAFT_PREFIX, deleteFiles, fileKeysWith, getFile, putFile } from './cart';

const KEY = 'tbsp-design-drafts-v1';
const MAX_AGE = 30 * 24 * 3600_000;
const MAX_DRAFTS = 12;

export interface DraftState {
  color: string;
  sizes: Record<string, number>;
  /** Plain order (no artwork): the chosen method and print spots. */
  decoration?: string;
  locations?: string[];
  /** Screen printing ink colors per location, as chosen in the price box. */
  inks?: Record<string, number>;
  artHelp?: { on: boolean; type: string; notes: string };
  artLater?: boolean;
  arts: DraftArt[];
}
interface StoredArt extends Omit<DraftArt, 'file' | 'original'> {
  fileKey: string; name: string; type: string;
  originalKey?: string; originalName?: string; originalType?: string;
}
interface Stored extends Omit<DraftState, 'arts'> { at: number; arts: StoredArt[] }

function readAll(): Record<string, Stored> {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || 'null');
    return data && typeof data === 'object' && data.v === 1 && data.drafts && typeof data.drafts === 'object' ? data.drafts : {};
  } catch {
    return {};
  }
}
function writeAll(drafts: Record<string, Stored>) {
  // Newest first, at most MAX_DRAFTS, none older than MAX_AGE.
  const now = Date.now();
  const keep = Object.entries(drafts).filter(([, d]) => now - d.at < MAX_AGE).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_DRAFTS);
  try { localStorage.setItem(KEY, JSON.stringify({ v: 1, drafts: Object.fromEntries(keep) })); } catch { /* storage blocked or full */ }
}

/** Each File is stored once; later saves reuse its key. */
const keyOf = new WeakMap<File, string>();
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
async function storeFile(slug: string, file: File) {
  const known = keyOf.get(file);
  if (known) return known;
  const key = `${DRAFT_PREFIX}${slug}/${uid()}`;
  await putFile(key, file);
  keyOf.set(file, key);
  return key;
}

/** Removes stored draft files no draft refers to any more. */
async function gcFiles() {
  const used = new Set(Object.values(readAll()).flatMap((d) => d.arts.flatMap((a) => [a.fileKey, a.originalKey].filter(Boolean) as string[])));
  const all = await fileKeysWith(DRAFT_PREFIX);
  // A file another tab stored a moment ago may not be in the index yet: leave fresh ones alone.
  const fresh = (k: string) => { const id = k.split('/').pop() || ''; return Date.now() - parseInt(id.slice(0, -5), 36) < 120_000; };
  await deleteFiles(all.filter((k) => !used.has(k) && !fresh(k)));
}

const isEmpty = (s: DraftState) => !s.arts.length && !Object.values(s.sizes).some((n) => n > 0) && !s.artHelp?.on;

/** Saves (or, when there's nothing worth keeping, removes) the draft for a product. */
export async function saveDraft(slug: string, state: DraftState) {
  if (!slug) return;
  if (isEmpty(state)) { await clearDraft(slug); return; }
  const arts: StoredArt[] = [];
  for (const a of state.arts) {
    const { file, original, ...rest } = a;
    const fileKey = await storeFile(slug, file);
    const orig = original ? { originalKey: await storeFile(slug, original), originalName: original.name, originalType: original.type } : {};
    arts.push({ ...rest, fileKey, name: file.name, type: file.type, ...orig });
  }
  const all = readAll();
  all[slug] = { ...state, arts, at: Date.now() };
  writeAll(all);
  await gcFiles();
}

/** The saved draft for a product with its files, or null. Artwork whose file is gone is skipped. */
export async function loadDraft(slug: string): Promise<DraftState | null> {
  const d = readAll()[slug];
  if (!d || Date.now() - d.at > MAX_AGE) return null;
  const arts: DraftArt[] = [];
  for (const a of d.arts) {
    const blob = await getFile(a.fileKey);
    if (!blob) continue;
    const { fileKey, name, type, originalKey, originalName, originalType, ...rest } = a;
    const file = new File([blob], name, { type: type || blob.type });
    keyOf.set(file, fileKey);
    let original: File | undefined;
    if (originalKey) {
      const ob = await getFile(originalKey);
      if (ob) { original = new File([ob], originalName || name, { type: originalType || ob.type }); keyOf.set(original, originalKey); }
    }
    arts.push({ ...rest, file, ...(original ? { original } : {}) });
  }
  const { at: _at, arts: _arts, ...state } = d;
  return { ...state, arts };
}

/** Forgets a product's draft (added to the cart, ordered, or "Start over"). */
export async function clearDraft(slug: string) {
  const all = readAll();
  if (!all[slug]) return;
  delete all[slug];
  writeAll(all);
  await gcFiles();
}

/** True when a product has a saved draft (no files read). */
export const hasDraft = (slug: string) => !!readAll()[slug];
