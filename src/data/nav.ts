// Main navigation: five clear menus (no overlapping links). Custom projects sit under Business & groups.
// `feature: 'products'` renders the catalog menu (collection photos + brands) from src/lib/catalog.

export interface NavLink { label: string; href: string }
export interface NavColumn { title?: string; links: NavLink[] }
export interface NavMenu { label: string; href: string; columns?: NavColumn[]; feature?: 'ai' | 'products' }

export const NAV: NavMenu[] = [
  { label: 'Products', href: '/catalog/', feature: 'products' },
  {
    label: 'T-shirts', href: '/products/t-shirts/',
    columns: [
      { links: [{ label: 'Short sleeve t-shirts', href: '/catalog/?sub=t-shirts' }, { label: 'Long sleeve t-shirts', href: '/catalog/?sub=long-sleeves' }, { label: 'Tank tops', href: '/catalog/?sub=tank-tops' }] },
      { links: [{ label: 'All-over print tees', href: '/products/t-shirts/custom-all-over-t-shirt-printing-in-los-angeles/' }, { label: 'Screen printed t-shirts', href: '/products/t-shirts/t-shirt-screen-printing-near-me/' }] },
      { links: [{ label: 'Rush & Super Rush tees', href: '/same-day-t-shirt-printing-los-angeles/' }, { label: 'Choosing a print method', href: '/products/t-shirts/custom-printed-t-shirts/' }, { label: 'Which blank to pick', href: '/the-best-custom-t-shirt-shop-in-la/' }] },
      { links: [{ label: 'View all custom t-shirts', href: '/products/t-shirts/' }] },
    ],
  },
  {
    label: 'Apparel', href: '/products/',
    columns: [
      { links: [{ label: 'Hoodies', href: '/products/sweatshirts-hoodies/custom-hoodies/' }, { label: 'Crewneck sweatshirts', href: '/products/sweatshirts-hoodies/custom-sweatshirts/' }, { label: 'Zip hoodies', href: '/catalog/?sub=zip-hoodies' }, { label: 'View all sweatshirts', href: '/products/sweatshirts-hoodies/' }] },
      { links: [{ label: 'Hats & caps', href: '/products/hats/' }, { label: 'Dad hats', href: '/catalog/?sub=dad-hats' }, { label: 'Embroidered hats', href: '/services/embroidery/' }] },
      { links: [{ label: 'Polo shirts', href: '/products/business-and-polos-landings/' }, { label: 'Jackets & outerwear', href: '/products/outwear/' }, { label: 'Workwear & uniforms', href: '/services/embroidery/custom-embroidery/' }] },
      { links: [{ label: 'Team jerseys', href: '/products/team-uniforms-jerseys/' }, { label: 'All-over print apparel', href: '/products/t-shirts/custom-all-over-t-shirt-printing-in-los-angeles/' }, { label: 'View all products', href: '/catalog/' }] },
    ],
  },
  {
    label: 'Promo products', href: '/for/promotional-products/',
    columns: [
      { links: [{ label: 'Beanies', href: '/catalog/?sub=beanies' }, { label: 'Totes', href: '/catalog/?sub=totes' }] },
      { links: [{ label: 'Bags & totes', href: '/products/bags/' }, { label: 'Custom bags', href: '/products/bags/customize-bag/' }] },
      { links: [{ label: 'Towels', href: '/products/towels/' }] },
      { links: [{ label: 'Trade show swag', href: '/event-apparel/trade-show-swag-anaheim/' }, { label: 'Promo merch ideas', href: '/for/promotional-products/' }] },
    ],
  },
  { label: 'Design Studio', href: '/custom-projects/', feature: 'ai' },
  {
    label: 'Business & groups', href: '/solutions/',
    columns: [
      { title: 'For business', links: [{ label: 'Small businesses', href: '/small-business/' }, { label: 'Clothing brands', href: '/for/retail-brands/' }, { label: 'Restaurants', href: '/for/restaurants/' }, { label: 'Staff uniforms', href: '/services/embroidery/custom-embroidery/' }, { label: 'Fulfillment', href: '/fulfillment/' }, { label: 'Custom projects', href: '/custom-projects/' }] },
      { title: 'For groups & events', links: [{ label: 'Events & tours', href: '/event-apparel/' }, { label: 'Teams & leagues', href: '/products/team-uniforms-jerseys/' }, { label: 'Schools', href: '/for/schools/' }, { label: 'Non-profits', href: '/for/non-profits/' }, { label: 'Clubs & groups', href: '/clubs-groups/' }] },
      { title: 'Tools & resources', links: [{ label: 'Get a quote', href: '/quick-quote/' }, { label: 'Turnaround options', href: '/learn-delivery-time/' }, { label: 'Design tips', href: '/helpful-design-tips/' }, { label: 'Guides & articles', href: '/blog/' }, { label: 'FAQ', href: '/faq/' }] },
    ],
  },
];
