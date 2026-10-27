// The visitor's contact details, confirmed once (usually with Max) and kept on this device so
// checkout and the quote form are filled in for them. "Forget me" clears it.
export interface Contact { name?: string; email?: string; phone?: string; company?: string }

const KEY = 'tbsp-contact';

export function getContact(): Contact | null {
  try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); return c && (c.name || c.email) ? c : null; } catch { return null; }
}
export function saveContact(c: Contact) {
  const clean: Contact = {};
  for (const k of ['name', 'email', 'phone', 'company'] as const) { const v = (c[k] || '').trim(); if (v) clean[k] = v; }
  try { localStorage.setItem(KEY, JSON.stringify(clean)); } catch { /* ignore */ }
  return clean;
}
export function forgetContact() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

/** Fill empty name/email/phone/company fields of a form from the saved details. */
export function prefillContact(form: HTMLFormElement) {
  const c = getContact();
  if (!c) return;
  for (const k of ['name', 'email', 'phone', 'company'] as const) {
    const f = form.elements.namedItem(k) as HTMLInputElement | null;
    if (f && !f.value && c[k]) f.value = c[k]!;
  }
}

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
