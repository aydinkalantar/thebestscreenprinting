// Online ordering: instant prices and card checkout from the studio admin
// (design.thebestscreenprinting.com /api/public/price and /api/public/order).
// The studio decides everything: when online orders are off it answers
// { enabled: false } and the site keeps the quote flow only.
import { business } from '../data/business';

export const STUDIO_API = (import.meta.env.PUBLIC_STUDIO_API as string | undefined) || business.studioUrl;

export interface PriceLocation { placement: string; method: string; colors?: number; widthIn?: number; heightIn?: number }
export type ArtHelpType = 'cleanup' | 'layout' | 'custom';
export interface ArtHelp { type: ArtHelpType; notes?: string }
export interface PriceItemInput { brand: string; style: string; color: string; sizes: Record<string, number>; locations: PriceLocation[]; productName?: string; artHelp?: ArtHelp }
export interface ArtHelpOptions { cleanup?: { price: number }; layout?: { price: number }; custom?: { price: number; from?: boolean }; revisionPrice?: number; extraDays?: number; revisionsIncluded?: number }
export const ART_HELP_LABELS: Record<ArtHelpType, string> = { cleanup: 'Art cleanup / vectorize', layout: 'Text or simple layout', custom: 'Custom design' };
export interface PricedItem {
  ok: boolean; quoteOnly?: string; title: string; color: string; quantity: number;
  sizePrices: Record<string, number>; basePrice: number; subtotal: number; setup: number;
  next: { qty: number; perPiece: number } | null; stockShort: { size: string; stock: number }[];
  /** Artwork help fee for this item, when asked for. */ artFee?: number;
}
export interface Totals { subtotal: number; setup: number; shipping: number; tax: number; taxRate: number; total: number; /** Rush / Super Rush fee, when the studio prices turnaround. */ rush?: number; /** Artwork help fees. */ art?: number; rushPercent?: number; turnaround?: string; /** Estimated ready date (ISO). */ readyBy?: string; businessDays?: number; /** e.g. Super Rush over its piece limit. */ turnaroundError?: string }
export type TurnaroundOptions = { normal: { days: number }; rush?: { percent: number; days: number }; superrush?: { percent: number; days: number; maxPieces?: number } };
export type Turnaround = 'normal' | 'rush' | 'superrush';
export type PriceResponse =
  | { enabled: false }
  | { enabled: true; items: PricedItem[]; totals: Totals | null; payment: { options: ('full' | 'deposit')[]; depositPercent: number }; delivery: { pickup: string | null; shipping: number | null }; /** Present once the studio prices turnaround; only the options that are on. */ turnaround?: TurnaroundOptions; /** Present when the artwork help service is on. */ artHelp?: ArtHelpOptions };

/** Size of a placed artwork, in inches (DTF and other methods are priced by print size). */
export const printSize = (w?: number, h?: number) => (w && h && w > 0 && h > 0 ? { widthIn: Math.round(w * 10) / 10, heightIn: Math.round(h * 10) / 10 } : {});

export const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Prices a set of items. Returns null when the studio can't be reached (the site then just shows the quote flow). */
/** `state`: the ship-to state (free shipping is for the lower 48 only). */
export async function fetchPrices(items: PriceItemInput[], delivery: 'pickup' | 'ship' = 'pickup', signal?: AbortSignal, turnaround?: Turnaround, state?: string): Promise<PriceResponse | null> {
  try {
    const res = await fetch(`${STUDIO_API}/api/public/price`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items, delivery, ...(turnaround ? { turnaround } : {}), ...(delivery === 'ship' && state ? { state } : {}) }), signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as PriceResponse;
  } catch {
    return null;
  }
}

export interface OrderResult { ok: true; orderNumber: string; checkoutUrl: string; invoiceUrl: string; total: number }
export interface OrderError { ok: false; error: string; field?: string; quoteOnly?: boolean; orderNumber?: string; invoiceUrl?: string }

export async function placeOrder(form: FormData): Promise<OrderResult | OrderError> {
  try {
    const res = await fetch(`${STUDIO_API}/api/public/order`, { method: 'POST', body: form });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 201 && typeof data.checkoutUrl === 'string') return { ok: true, ...(data as Omit<OrderResult, 'ok'>) };
    return { ok: false, error: typeof data.error === 'string' ? data.error : `Something went wrong. Please call ${business.phoneDisplay}.`, field: data.field as string | undefined, quoteOnly: !!data.quoteOnly, orderNumber: data.orderNumber as string | undefined, invoiceUrl: data.invoiceUrl as string | undefined };
  } catch {
    return { ok: false, error: `We couldn't reach our server. Please try again or call ${business.phoneDisplay}.` };
  }
}
