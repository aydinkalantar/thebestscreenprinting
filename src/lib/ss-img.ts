// S&S product photos are served through our own Worker at /ss-img/<path> instead of straight
// from cdn.ssactivewear.com. Browsers then never depend on S&S answering a hotlink, the edge
// keeps a copy for 30 days, and a photo S&S can't serve shows a plain placeholder instead of a
// broken-image icon. The Worker rewrites URLs in pages, scripts and JSON as they are served;
// ssImg() covers URLs that arrive at runtime (Max's replies, carts saved before this change).

export const SS_ORIGIN = 'https://cdn.ssactivewear.com/';
export const SS_PREFIX = '/ss-img/';

/** cdn.ssactivewear.com URL → the same photo through this site. Anything else is returned as is. */
export function ssImg(url: string): string;
export function ssImg(url: string | null | undefined): string | null | undefined;
export function ssImg(url: string | null | undefined) {
  // A regex, not SS_ORIGIN: the Worker rewrites that plain string inside served scripts.
  const m = url ? /^https:\/\/cdn\.ssactivewear\.com\/(.+)$/.exec(url) : null;
  if (!m) return url;
  const origin = typeof location !== 'undefined' ? location.origin : '';
  return `${origin}${SS_PREFIX}${m[1]}`;
}
