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

/**
 * Where this visitor first came from (Google, ChatGPT, Instagram…), remembered for 30 days in
 * their own browser (no cookies, nothing sent until they ask for a quote or order). A later
 * visit doesn't replace it, except a visit with no source (typed in) is replaced by one with a
 * source. Sent with each request as `visit`; the studio shows it on the job and in Reports.
 */
const VISIT_KEY = 'site-first-visit';
const VISIT_DAYS = 30;

interface Visit { ref: string; utm: string; landing: string; at: string }

const ownHost = (u: string) => { try { return new URL(u).hostname === location.hostname; } catch { return true; } };

function readVisit(): Visit | null {
  try {
    const v = JSON.parse(localStorage.getItem(VISIT_KEY) || 'null') as Visit | null;
    if (!v || Date.now() - Date.parse(v.at) > VISIT_DAYS * 86_400_000) return null;
    return v;
  } catch { return null; }
}

export function rememberVisit() {
  try {
    const ref = document.referrer && !ownHost(document.referrer) ? document.referrer : '';
    const utm = new URLSearchParams(location.search).get('utm_source') || '';
    const now: Visit = { ref, utm, landing: location.pathname + location.search, at: new Date().toISOString() };
    const old = readVisit();
    const hasSource = (v: Visit) => !!(v.ref || v.utm);
    if (!old || (!hasSource(old) && hasSource(now))) localStorage.setItem(VISIT_KEY, JSON.stringify(now));
  } catch { /* private window: nothing remembered */ }
}

/** The remembered visit as the request field, or '' when there is none. */
export const visitField = () => { const v = readVisit(); return v ? JSON.stringify(v) : ''; };

/** Adds `visit` to every form the page sends (forms read with new FormData(form)). */
export function attachVisitToForms() {
  try {
    document.addEventListener('formdata', (e) => { const v = visitField(); if (v && !e.formData.has('visit')) e.formData.set('visit', v); });
  } catch { /* old browser */ }
}
