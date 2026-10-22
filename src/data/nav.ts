// Main navigation: Custom Ink-style mega menus, with TBSP's AI studio as its own menu.

export interface NavLink { label: string; href: string }
export interface NavColumn { title?: string; links: NavLink[] }
export interface NavMenu { label: string; href: string; columns?: NavColumn[]; feature?: 'ai' }

export const NAV: NavMenu[] = [
  {
    label: 'Custom T-shirts', href: '/products/t-shirts/',
    columns: [
      { links: [{ label: 'Short sleeve t-shirts', href: '/catalog/?sub=t-shirts' }, { label: 'Long sleeve t-shirts', href: '/catalog/?sub=long-sleeves' }, { label: 'Tank tops', href: '/catalog/?sub=tank-tops' }] },
      { links: [{ label: 'All-over print tees', href: '/products/t-shirts/custom-all-over-t-shirt-printing-in-los-angeles/' }, { label: 'No-minimum t-shirts', href: '/products/t-shirts/custom-all-over-t-shirt-printing-no-minimum/' }, { label: 'Screen printed t-shirts', href: '/products/t-shirts/t-shirt-screen-printing-near-me/' }] },
      { links: [{ label: 'Rush & Super Rush tees', href: '/same-day-t-shirt-printing-los-angeles/' }, { label: 'Choosing a print method', href: '/products/t-shirts/custom-printed-t-shirts/' }, { label: 'Which blank to pick', href: '/the-best-custom-t-shirt-shop-in-la/' }] },
      { links: [{ label: 'View all custom t-shirts', href: '/products/t-shirts/' }] },
    ],
  },
  {
    label: 'Apparel', href: '/products/',
    columns: [
      { links: [{ label: 'Hoodies', href: '/products/sweatshirts-hoodies/custom-hoodies/' }, { label: 'Crewneck sweatshirts', href: '/products/sweatshirts-hoodies/custom-sweatshirts/' }, { label: 'Quarter zips & pullovers', href: '/catalog/?sub=pullovers' }, { label: 'View all sweatshirts', href: '/products/sweatshirts-hoodies/' }] },
      { links: [{ label: 'Hats & caps', href: '/products/hats/' }, { label: 'Dad hats', href: '/catalog/?sub=dad-hats' }, { label: 'Embroidered hats', href: '/services/embroidery/' }] },
      { links: [{ label: 'Polo shirts', href: '/products/business-and-polos-landings/' }, { label: 'Jackets & outerwear', href: '/products/outwear/' }, { label: 'Workwear & uniforms', href: '/services/embroidery/custom-embroidery/' }] },
      { links: [{ label: 'Team jerseys', href: '/products/team-uniforms-jerseys/' }, { label: 'All-over print apparel', href: '/catalog/?sub=all-over-prints' }, { label: 'View all products', href: '/catalog/' }] },
    ],
  },
  {
    label: 'Promotional Products', href: '/for/promotional-products/',
    columns: [
      { links: [{ label: 'Drinkware', href: '/catalog/?sub=drinkware' }, { label: 'Home & decor', href: '/catalog/?cat=home' }] },
      { links: [{ label: 'Bags & totes', href: '/products/bags/' }, { label: 'Custom bags', href: '/products/bags/customize-bag/' }] },
      { links: [{ label: 'Towels', href: '/products/towels/' }, { label: 'Tech accessories', href: '/catalog/?sub=tech' }] },
      { links: [{ label: 'Trade show swag', href: '/event-apparel/trade-show-swag-anaheim/' }, { label: 'Promo merch ideas', href: '/for/promotional-products/' }] },
    ],
  },
  { label: 'Design Studio', href: '/custom-projects/', feature: 'ai' },
  {
    label: 'Business & Groups', href: '/solutions/',
    columns: [
      { title: 'For business', links: [{ label: 'Small businesses', href: '/small-business/' }, { label: 'Clothing brands', href: '/for/retail-brands/' }, { label: 'Restaurants', href: '/for/restaurants/' }, { label: 'Staff uniforms', href: '/services/embroidery/custom-embroidery/' }, { label: 'Fulfillment', href: '/fulfillment/' }] },
      { title: 'For groups & events', links: [{ label: 'Events & tours', href: '/event-apparel/' }, { label: 'Teams & leagues', href: '/products/team-uniforms-jerseys/' }, { label: 'Schools', href: '/for/schools/' }, { label: 'Non-profits', href: '/for/non-profits/' }, { label: 'Clubs & groups', href: '/clubs-groups/' }] },
      { title: 'Tools & resources', links: [{ label: 'Get a quote', href: '/quick-quote/' }, { label: 'Turnaround options', href: '/learn-delivery-time/' }, { label: 'Design tips', href: '/helpful-design-tips/' }, { label: 'Guides & articles', href: '/blog/' }, { label: 'FAQ', href: '/faq/' }] },
    ],
  },
  {
    label: 'Custom Projects', href: '/custom-projects/',
    columns: [
      { links: [{ label: 'Custom cut & sew', href: '/custom-projects/' }, { label: 'Sublimation & all-over', href: '/products/t-shirts/custom-all-over-t-shirt-printing-in-los-angeles/' }] },
      { links: [{ label: 'Embossing', href: '/services/embossing/' }, { label: 'Oversize prints', href: '/services/large-format-screen-printing/' }] },
      { links: [{ label: 'Screen printing', href: '/screen-printing/' }, { label: 'Embroidery', href: '/services/embroidery/' }] },
      { links: [{ label: 'DTF transfers', href: '/services/direct-to-film/' }, { label: 'DTG printing', href: '/services/direct-to-garment/' }] },
    ],
  },
];
