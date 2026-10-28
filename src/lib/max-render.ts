// Mockups for Max's order card: the product page itself, loaded hidden with ?render=<job>, places
// the designs exactly like its preview (photo analysis, print areas, admin boxes) in the chosen
// color and posts back the rendered sides plus the placed artwork with its size and position.
// One job at a time; each takes a second or two.
import { putFile } from './cart';

export interface RenderPlacement { file: File; location: string; method: string; widthIn?: number }
export interface RenderResult {
  mockups: { side: string; blob: Blob }[];
  /** Same shape as a cart item's placements (design.snapshot()). */
  placements: { locId: string; location: string; decoration: string; notes?: string; file: string; blob: Blob; widthIn: number; heightIn: number; fromTopIn: number; fromCenterIn: number; x: number; y: number; w: number }[];
  color: string; image: string;
}

let queue: Promise<unknown> = Promise.resolve();

export function renderOnProduct(slug: string, productId: string, color: string, list: RenderPlacement[]): Promise<RenderResult | null> {
  const run = () => new Promise<RenderResult | null>((resolve) => {
    void (async () => {
      const job = Math.random().toString(36).slice(2, 10);
      const files = [];
      for (const [i, p] of list.entries()) {
        const key = `render/${job}/${i}`;
        await putFile(key, p.file);
        files.push({ key, name: p.file.name, type: p.file.type, location: p.location, method: p.method, widthIn: p.widthIn });
      }
      try { sessionStorage.setItem(`tbsp-render-${job}`, JSON.stringify({ productId, color, list: files })); } catch { resolve(null); return; }
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      // Off screen but laid out at a desktop size, so the preview measures like it does for shoppers.
      frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:900px;border:0;visibility:hidden;pointer-events:none';
      const done = (r: RenderResult | null) => {
        window.removeEventListener('message', onMsg);
        clearTimeout(timer);
        frame.remove();
        try { sessionStorage.removeItem(`tbsp-render-${job}`); } catch { /* ignore */ }
        resolve(r);
      };
      const onMsg = (e: MessageEvent) => {
        if (e.origin !== location.origin || e.data?.type !== 'tbsp-render' || e.data.job !== job) return;
        done(e.data.error ? null : { mockups: e.data.mockups || [], placements: e.data.placements || [], color: e.data.color, image: e.data.image });
      };
      const timer = window.setTimeout(() => done(null), 25_000);
      window.addEventListener('message', onMsg);
      frame.src = `/catalog/${slug}/?render=${job}`;
      document.body.append(frame);
    })();
  });
  const p = queue.then(run, run);
  queue = p.catch(() => null);
  return p;
}
