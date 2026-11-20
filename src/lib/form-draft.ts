// What a visitor typed into a form, kept on this device until the form is sent, so a refresh,
// an accidental Back or a phone closing the tab doesn't wipe it (standard on shop sites).
// Files can't be kept (browsers don't allow it); everything else with a `name` is.
// Kept for a week, then dropped. Fails quietly when storage is off (private mode).

const PREFIX = 'tbsp-draft:';
const WEEK = 7 * 24 * 3600 * 1000;

type Saved = { at: number; v: Record<string, string | string[]> };

const fieldsOf = (form: HTMLFormElement, skip: Set<string>) =>
  [...form.elements].filter((el): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement => {
    const f = el as HTMLInputElement;
    if (!f.name || skip.has(f.name) || f.disabled) return false;
    if (f instanceof HTMLInputElement && ['file', 'hidden', 'password', 'submit', 'button'].includes(f.type)) return false;
    // Spam traps are never filled back in.
    if (f.getAttribute('aria-hidden') === 'true' || f.tabIndex === -1) return false;
    return true;
  });

function read(key: string): Saved | null {
  try {
    const s = JSON.parse(localStorage.getItem(PREFIX + key) || 'null') as Saved | null;
    if (!s || Date.now() - s.at > WEEK) { localStorage.removeItem(PREFIX + key); return null; }
    return s;
  } catch { return null; }
}

export function clearDraft(key: string) { try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ } }

/**
 * Keep `form`'s fields on this device under `key`: fills them back in now (only fields still
 * empty / unchanged), then saves on every change. `skip`: field names the page sets itself.
 * Call `clearDraft(key)` once the form is sent.
 */
export function keepDraft(form: HTMLFormElement, key: string, opts: { skip?: string[] } = {}) {
  const skip = new Set(opts.skip ?? []);
  const saved = read(key);
  if (saved) {
    for (const f of fieldsOf(form, skip)) {
      const v = saved.v[f.name];
      if (v == null) continue;
      if (f instanceof HTMLInputElement && (f.type === 'checkbox' || f.type === 'radio')) {
        f.checked = Array.isArray(v) ? v.includes(f.value) : v === f.value;
      } else if (!f.value || (f instanceof HTMLSelectElement && f.selectedIndex === 0)) {
        f.value = Array.isArray(v) ? v[0] ?? '' : v;
      }
    }
  }
  let t = 0;
  const save = () => {
    clearTimeout(t);
    t = window.setTimeout(() => {
      const v: Saved['v'] = {};
      let any = false;
      for (const f of fieldsOf(form, skip)) {
        if (f instanceof HTMLInputElement && (f.type === 'checkbox' || f.type === 'radio')) {
          if (!f.checked) continue;
          if (f.type === 'checkbox') { const cur = v[f.name]; v[f.name] = [...(Array.isArray(cur) ? cur : []), f.value]; }
          else v[f.name] = f.value;
          if (f.type === 'checkbox') any = true;
        } else if (f.value.trim()) { v[f.name] = f.value; any = true; }
      }
      try {
        if (any) localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), v }));
        else localStorage.removeItem(PREFIX + key);
      } catch { /* ignore */ }
    }, 300);
  };
  form.addEventListener('input', save);
  form.addEventListener('change', save);
  // A form.reset() after sending empties the fields: forget them too.
  form.addEventListener('reset', () => { clearTimeout(t); clearDraft(key); });
}
