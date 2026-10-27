// Quote cart: several configured products sent as one quote request (/quote-cart/).
//
// Storage: a small JSON index in localStorage (item details, no files) and the files themselves
// (artwork + rendered mockups) in IndexedDB, keyed by `<itemId>/<name>`. Duplicated items share
// file keys; unreferenced files are removed by gc(). Every storage call is wrapped: without
// IndexedDB the files live in memory for this tab only (cartPersistsFiles() tells the UI to warn),
// and without localStorage the whole cart lives in memory.
//
// Changes are broadcast to other tabs (BroadcastChannel + the storage event) and to this tab
// (a `tbsp-cart` event on window), so badges update live.
import { business } from '../data/business';

export const CART_MIN = business.shopMinimum;
export const CART_MAX_ITEMS = 10;
const INDEX_KEY = 'tbsp-quote-cart-v1';
const CARRY_KEY = 'tbsp-quote-cart-carry';
const DB_NAME = 'tbsp-quote-cart';
const STORE = 'files';

/** One artwork placed on a product, with where it sits (fractions of the print area) for reuse. */
export interface CartPlacement {
  locId: string; location: string; decoration: string; notes?: string;
  file: string; fileKey: string; fileType: string; size: number;
  widthIn: number; heightIn: number; fromTopIn: number; fromCenterIn: number;
  x: number; y: number; w: number;
}
export interface CartItem {
  id: string; addedAt: number;
  productId: string; slug: string; name: string; brand: string; style: string; cat: string; sub: string;
  /** Product photo in the chosen color. */
  image: string; url: string;
  color: string;
  /** Size order as on the product page. */
  sizeOrder: string[];
  sizes: Record<string, number>;
  total: number;
  /** Plain decoration / locations (no artwork placed). With artwork they follow the placements. */
  decorations: string[]; locations: string[];
  placements: CartPlacement[];
  mockups: { side: string; key: string; size: number }[];
  /** Screen printing: ink colors per location, as chosen in the price box. */
  inks?: Record<string, number>;
  /** Paid artwork help (cleanup, layout or custom design), with the customer's notes. */
  artHelp?: { type: 'cleanup' | 'layout' | 'custom'; notes?: string };
}
export type NewCartItem = Omit<CartItem, 'id' | 'addedAt' | 'placements' | 'mockups' | 'total'> & {
  placements: (Omit<CartPlacement, 'fileKey' | 'fileType' | 'size'> & { blob: Blob })[];
  mockups: { side: string; blob: Blob }[];
};

// ── low-level storage ──────────────────────────────────────────────────────
let memoryIndex: CartItem[] | null = null;
const memoryFiles = new Map<string, Blob>();
let dbPromise: Promise<IDBDatabase | null> | null = null;
let idbOk = typeof indexedDB !== 'undefined';

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { idbOk = false; resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { idbOk = false; resolve(null); };
      req.onblocked = () => { idbOk = false; resolve(null); };
    } catch {
      idbOk = false;
      resolve(null);
    }
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  if (!db) throw new Error('IndexedDB unavailable');
  return new Promise<T | undefined>((resolve, reject) => {
    try {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    } catch (e) { reject(e); }
  });
}

/** Stores a file. Saved as bytes + type (Safari has been unreliable with Blobs in IndexedDB). */
export async function putFile(key: string, blob: Blob) {
  memoryFiles.set(key, blob);
  if (!idbOk) return;
  try {
    const buf = await blob.arrayBuffer();
    await tx('readwrite', (s) => s.put({ buf, type: blob.type }, key));
    memoryFiles.delete(key);
  } catch {
    idbOk = false; // quota or private mode: keep it in memory for this tab
  }
}

export async function getFile(key: string): Promise<Blob | null> {
  const mem = memoryFiles.get(key);
  if (mem) return mem;
  try {
    const rec = (await tx<{ buf: ArrayBuffer; type: string } | undefined>('readonly', (s) => s.get(key))) as { buf: ArrayBuffer; type: string } | undefined;
    return rec ? new Blob([rec.buf], { type: rec.type }) : null;
  } catch {
    return null;
  }
}

async function deleteFiles(keys: string[]) {
  keys.forEach((k) => memoryFiles.delete(k));
  if (!keys.length || !idbOk) return;
  try { await tx('readwrite', (s) => { keys.forEach((k) => s.delete(k)); }); } catch { /* ignore */ }
}

/** True while files are saved across pages (IndexedDB works). */
export async function cartPersistsFiles() { await openDb(); return idbOk; }

function readIndex(): CartItem[] {
  if (memoryIndex) return memoryIndex;
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return Array.isArray(data?.items) ? (data.items as CartItem[]) : [];
  } catch {
    return [];
  }
}

const channel = (() => { try { return new BroadcastChannel('tbsp-quote-cart'); } catch { return null; } })();

function writeIndex(items: CartItem[]) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify({ v: 1, items }));
    memoryIndex = null;
  } catch {
    memoryIndex = items; // storage blocked: this tab only
  }
  notify();
}

function notify() {
  try { window.dispatchEvent(new CustomEvent('tbsp-cart')); } catch { /* ignore */ }
  try { channel?.postMessage('changed'); } catch { /* ignore */ }
}

/** Calls `fn` whenever the cart changes, in this tab or another. Returns an unsubscribe. */
export function onCartChange(fn: () => void) {
  const onStorage = (e: StorageEvent) => { if (e.key === INDEX_KEY || e.key === null) fn(); };
  const onMsg = () => fn();
  window.addEventListener('tbsp-cart', fn);
  window.addEventListener('storage', onStorage);
  channel?.addEventListener('message', onMsg);
  // Back/forward cache: the page may come back with a stale count.
  window.addEventListener('pageshow', fn);
  return () => {
    window.removeEventListener('tbsp-cart', fn);
    window.removeEventListener('storage', onStorage);
    channel?.removeEventListener('message', onMsg);
    window.removeEventListener('pageshow', fn);
  };
}

// ── public API ─────────────────────────────────────────────────────────────
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
export const sumSizes = (sizes: Record<string, number>) => Object.values(sizes).reduce((n, v) => n + (v > 0 ? v : 0), 0);

export function cartItems(): CartItem[] { return readIndex(); }
export function cartCount(): number { return readIndex().length; }
export function cartPieces(): number { return readIndex().reduce((n, it) => n + it.total, 0); }
export function cartItem(id: string) { return readIndex().find((it) => it.id === id); }

/** Adds a configured product. Throws an Error with a customer-facing message when it can't. */
export async function addToCart(input: NewCartItem): Promise<CartItem> {
  const items = readIndex();
  if (items.length >= CART_MAX_ITEMS) throw new Error(`Your quote already has ${CART_MAX_ITEMS} products, the most we take in one request. Send it first, then start another.`);
  const total = sumSizes(input.sizes);
  if (total < CART_MIN) throw new Error(`Add at least ${CART_MIN} pieces of this product (${CART_MIN}-piece minimum per product).`);
  const id = uid();
  const placements: CartPlacement[] = [];
  for (const [n, p] of input.placements.entries()) {
    const fileKey = `${id}/art-${n + 1}`;
    await putFile(fileKey, p.blob);
    const { blob, ...rest } = p;
    placements.push({ ...rest, fileKey, fileType: blob.type, size: blob.size });
  }
  const mockups: CartItem['mockups'] = [];
  for (const m of input.mockups) {
    const key = `${id}/mockup-${m.side}`;
    await putFile(key, m.blob);
    mockups.push({ side: m.side, key, size: m.blob.size });
  }
  const item: CartItem = { ...input, id, addedAt: Date.now(), total, placements, mockups };
  writeIndex([...readIndex(), item]);
  return item;
}

/**
 * Replaces an item with a newly configured version (the "Edit" flow on the product page),
 * keeping its id and its place in the list. New files get fresh keys, so a duplicate that
 * shared the old files keeps them; files nothing uses any more are removed.
 */
export async function replaceCartItem(id: string, input: NewCartItem): Promise<CartItem> {
  const old = cartItem(id);
  if (!old) throw new Error('This product is no longer in your quote. Add it again.');
  const total = sumSizes(input.sizes);
  if (total < CART_MIN) throw new Error(`Add at least ${CART_MIN} pieces of this product (${CART_MIN}-piece minimum per product).`);
  const prefix = `${id}-${uid()}`;
  const placements: CartPlacement[] = [];
  for (const [n, p] of input.placements.entries()) {
    const fileKey = `${prefix}/art-${n + 1}`;
    await putFile(fileKey, p.blob);
    const { blob, ...rest } = p;
    placements.push({ ...rest, fileKey, fileType: blob.type, size: blob.size });
  }
  const mockups: CartItem['mockups'] = [];
  for (const m of input.mockups) {
    const key = `${prefix}/mockup-${m.side}`;
    await putFile(key, m.blob);
    mockups.push({ side: m.side, key, size: m.blob.size });
  }
  const item: CartItem = { ...input, id, addedAt: old.addedAt, total, placements, mockups };
  writeIndex(readIndex().map((it) => (it.id === id ? item : it)));
  await gc();
  return item;
}

export function updateCartItem(id: string, patch: Partial<Pick<CartItem, 'sizes'>>) {
  const items = readIndex().map((it) => {
    if (it.id !== id) return it;
    const next = { ...it, ...patch };
    next.total = sumSizes(next.sizes);
    return next;
  });
  writeIndex(items);
}

export async function removeCartItem(id: string) {
  writeIndex(readIndex().filter((it) => it.id !== id));
  await gc();
}

/** Copies an item (sharing its files). */
export function duplicateCartItem(id: string): CartItem | null {
  const items = readIndex();
  const i = items.findIndex((it) => it.id === id);
  if (i < 0 || items.length >= CART_MAX_ITEMS) return null;
  const copy: CartItem = { ...structuredClone(items[i]), id: uid(), addedAt: Date.now() };
  items.splice(i + 1, 0, copy);
  writeIndex(items);
  return copy;
}

export async function clearCart() {
  const keys = readIndex().flatMap(fileKeys);
  writeIndex([]);
  setCarry(null);
  await deleteFiles(keys);
  await gc();
}

const fileKeys = (it: CartItem) => [...it.placements.map((p) => p.fileKey), ...it.mockups.map((m) => m.key)];

/** Removes stored files no item refers to any more (removed items, other tabs). */
export async function gc() {
  const used = new Set(readIndex().flatMap(fileKeys));
  for (const k of [...memoryFiles.keys()]) if (!used.has(k)) memoryFiles.delete(k);
  if (!idbOk) return;
  try {
    const keys = ((await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys())) ?? []) as string[];
    await deleteFiles(keys.filter((k) => !used.has(k)));
  } catch { /* ignore */ }
}

// ── "Use same artwork on another product" ──────────────────────────────────
/** The cart item whose artwork the next product page should start with. */
export function getCarry(): string | null {
  try {
    const raw = localStorage.getItem(CARRY_KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (!data?.id || Date.now() - data.at > 24 * 3600_000) return null;
    return cartItem(data.id) ? data.id : null;
  } catch {
    return null;
  }
}
export function setCarry(id: string | null) {
  try {
    if (id) localStorage.setItem(CARRY_KEY, JSON.stringify({ id, at: Date.now() }));
    else localStorage.removeItem(CARRY_KEY);
  } catch { /* ignore */ }
}

/** Artwork files of an item, ready for the design preview. Missing files are skipped. */
export async function carryArtwork(id: string) {
  const it = cartItem(id);
  if (!it) return [];
  const out: { locId: string; location: string; decoration: string; notes?: string; x: number; y: number; w: number; file: File }[] = [];
  for (const p of it.placements) {
    const blob = await getFile(p.fileKey);
    if (!blob) continue;
    out.push({ locId: p.locId, location: p.location, decoration: p.decoration, notes: p.notes, x: p.x, y: p.y, w: p.w, file: new File([blob], p.file, { type: p.fileType || blob.type }) });
  }
  return out;
}
