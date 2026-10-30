// Google Analytics 4 events (production only: gtag exists only where Base.astro loads it).
// Event names, so Max and the quote form can be compared in GA4 › Reports › Engagement › Events:
//   max_open · max_first_message · max_call_start · max_price_shown · max_contact_saved · max_quote_emailed · max_checkout_open
//   quote_form_submit (source: form | cart | product)
type Gtag = (cmd: 'event', name: string, params?: Record<string, unknown>) => void;

export function track(name: string, params: Record<string, unknown> = {}) {
  try {
    const g = (window as unknown as { gtag?: Gtag }).gtag;
    if (typeof g === 'function') g('event', name, { page_path: location.pathname, ...params });
  } catch { /* analytics must never break the page */ }
}
