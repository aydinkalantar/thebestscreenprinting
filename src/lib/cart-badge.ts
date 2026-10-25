// Quote cart count on the header icon and the phone tab bar's Quote tab, kept live across tabs.
// Markup: [data-cart-count] holds the number (hidden at 0); [data-cart-link] gets an aria-label;
// [data-cart-tab] (the tab bar's Quote tab) points at the cart while it has products.
import { cartCount, onCartChange } from './cart';

function update() {
  const n = cartCount();
  const label = n ? `Your quote, ${n} product${n === 1 ? '' : 's'}` : 'Your quote (empty)';
  document.querySelectorAll<HTMLElement>('[data-cart-count]').forEach((el) => {
    el.textContent = n > 9 ? '9+' : String(n);
    el.hidden = n === 0;
  });
  document.querySelectorAll<HTMLElement>('[data-cart-link]').forEach((el) => el.setAttribute('aria-label', label));
  document.querySelectorAll<HTMLAnchorElement>('[data-cart-tab]').forEach((el) => {
    el.href = n ? '/quote-cart/' : '/quick-quote/';
    el.setAttribute('aria-label', n ? `Quote, ${n} product${n === 1 ? '' : 's'}` : 'Quote');
  });
}
update();
onCartChange(update);
