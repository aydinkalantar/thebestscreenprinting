// Website funnel for Admin › Reports in the studio: tells the studio a visitor reached a step
// (visit, product page, added their design). Anonymous: no cookies, nothing about the person;
// the studio counts each step once per visitor per day and leaves bots out.
import { STUDIO_API } from './online';

export type HitKind = 'visit' | 'product' | 'designer';
const sent = new Set<string>();

export function hit(kind: HitKind) {
  try {
    if (sent.has(kind) || navigator.webdriver) return;
    sent.add(kind);
    const utm = new URLSearchParams(location.search).get('utm_source') || '';
    const body = JSON.stringify({ kind, ref: document.referrer || '', utm });
    const url = `${STUDIO_API}/api/public/hit`;
    // text/plain keeps it a simple request (no CORS preflight) and survives leaving the page.
    if (!navigator.sendBeacon?.(url, new Blob([body], { type: 'text/plain' }))) {
      void fetch(url, { method: 'POST', body, keepalive: true, mode: 'no-cors', headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
    }
  } catch { /* never break the page */ }
}
