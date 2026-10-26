// Cart count on the header icon and the phone tab bar's Cart tab, kept live across tabs.
// Markup: [data-cart-count] holds the number (hidden at 0); [data-cart-link] gets an aria-label;
// [data-cart-tab] is the tab bar's Cart tab.
import { cartCount, onCartChange } from './cart';

function update() {
  const n = cartCount();
  const label = n ? `Cart, ${n} product${n === 1 ? '' : 's'}` : 'Cart (empty)';
  document.querySelectorAll<HTMLElement>('[data-cart-count]').forEach((el) => {
    el.textContent = n > 9 ? '9+' : String(n);
    el.hidden = n === 0;
  });
  document.querySelectorAll<HTMLElement>('[data-cart-link]').forEach((el) => el.setAttribute('aria-label', label));
  document.querySelectorAll<HTMLAnchorElement>('[data-cart-tab]').forEach((el) => {
    el.setAttribute('aria-label', label);
  });
}
update();
onCartChange(update);
