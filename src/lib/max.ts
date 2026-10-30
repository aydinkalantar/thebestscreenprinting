// Max, the merch agent, on phones: the tab bar's center orb and the product
// page's sticky bar open him through openMax(). This is the one place to switch
// what "opening Max" means.
//
//   MODE = 'sheet'      the quick sheet in MaxSheet.astro (text box → quote form,
//                       plus quote / call / text / email shortcuts)
//   MODE = 'assistant'  the live assistant panel (AssistantWidget.astro)
//   MODE = 'auto'       the live assistant when it is on the page, else the sheet
//
// When the real assistant ships, either flip MODE or replace openMaxSheet()'s body.
import { openSheet, wireSheet } from './sheet';
import { track } from './analytics';

type Mode = 'sheet' | 'assistant' | 'auto';
const MODE: Mode = 'auto';

let context = '';
let lastPrefill = '';

/** Pages set what Max should already know (the product page: product + color). */
export function setMaxContext(text: string) { context = text; }

function openAssistant(): boolean {
  const live = document.querySelector<HTMLButtonElement>('#tb-assistant [data-open]');
  if (!live) return false;
  live.click();
  return true;
}

function openMaxSheet(prefill: string) {
  const el = document.querySelector<HTMLElement>('[data-max-sheet]');
  if (!el) { location.href = prefill ? `/quick-quote/?details=${encodeURIComponent(prefill)}` : '/quick-quote/'; return; }
  wireSheet(el);
  const box = el.querySelector<HTMLTextAreaElement>('textarea[name="details"]');
  // Prefill without clobbering what the visitor already typed.
  if (box && (!box.value.trim() || box.value === lastPrefill)) { box.value = prefill; lastPrefill = prefill; }
  openSheet(el, { focus: el.querySelector<HTMLElement>('[data-sheet-close]:not([data-sheet-backdrop])') });
}

export function openMax(prefill: string = context) {
  if (MODE !== 'sheet' && openAssistant()) return;
  if (MODE === 'assistant') return;
  track('max_open');
  openMaxSheet(prefill);
  // Still inside the visitor's tap: Max can start a voice call from here (max-chat.ts).
  window.dispatchEvent(new Event('tbsp-max-open'));
}

// Any [data-max-open] button opens Max.
document.querySelectorAll<HTMLElement>('[data-max-open]').forEach((b) => {
  if (b.dataset.maxWired) return;
  b.dataset.maxWired = '1';
  b.addEventListener('click', (e) => { e.preventDefault(); openMax(); });
});
