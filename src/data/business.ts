// Single source of truth for the business entity (name, address, phone, hours).
// Keep this identical to the Google Business Profile, Yelp, Apple Maps and Bing Places.
export const business = {
  name: 'The Best Screen Printing',
  shortName: 'TBSP',
  url: 'https://thebestscreenprinting.com',
  phone: '+1-323-433-0033',
  phoneDisplay: '(323) 433-0033',
  email: 'sales@tbsp.la',
  address: {
    streetAddress: '5738 Holmes Ave.',
    addressLocality: 'Los Angeles',
    addressRegion: 'CA',
    postalCode: '90058',
    addressCountry: 'US',
  },
  openingHours: ['Mo-Fr 09:00-17:00'],
  sameAs: [
    'https://www.facebook.com/TheBestScreenPrinting/',
    'https://twitter.com/tbspla',
    'https://www.instagram.com/tbsp.la/',
    'https://www.pinterest.com/tbspla/',
    'https://www.youtube.com/c/Thebestscreenprinting',
    'https://www.yelp.com/biz/the-best-screen-printing-and-embroidery-los-angeles-2',
  ],
  // The design studio and customer accounts (the Next.js app) live here, noindexed.
  studioUrl: 'https://design.thebestscreenprinting.com',
  // Off until the studio is ready for production: hides every link to it, and Max.
  studioLive: false,
  // Max, the merch agent, on this site (chat panel; his brain runs in the studio admin).
  maxLive: true,
  /** Lowest minimum (DTG, DTF, heat transfer). Everything is made in-house; we don't decorate fewer. */
  shopMinimum: 6,
  /** Screen printing and embroidery minimum; smaller requests get offered DTG or DTF. */
  screenMinimum: 12,
  assistantName: 'Max',
  /** Google Analytics 4 measurement ID (public). Only loads on the production host. */
  gaId: 'G-MHYSRCDHB1',
  /**
   * Turnaround options shown across the site and offered on the quote form.
   * `time` is filled in once confirmed; until then pages say it's confirmed with the quote.
   */
  turnaround: [
    { id: 'normal', name: 'Normal', time: 'About 2 weeks', fee: null as string | null, note: 'Standard delivery, estimated to arrive in about two weeks.' },
    { id: 'rush', name: 'Rush', time: '1 week', fee: '+15%' as string | null, note: 'One-week rush delivery, at your doorstep in a week.' },
    { id: 'super-rush', name: 'Super Rush', time: '3 business days', fee: '+30%' as string | null, note: 'Order by 2:00 PM ET Tuesday to have it in hand by Friday.' },
  ],
  /** Fine print for Super Rush. */
  superRushNote: 'Not available for all products, styles or PO Box addresses.',
  /** Areas we serve without a shop address there (service-area business). */
  serviceAreas: ['Los Angeles, CA', 'Cleveland, OH'],
  /** Shipping per order to any address in the lower 48 (same as online checkout): flat under the threshold, free from it. */
  shippingFlat: 35,
  shippingFreeFrom: 300,
} as const;

export const localBusinessJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'LocalBusiness',
  '@id': `${business.url}/#organization`,
  name: business.name,
  url: business.url,
  telephone: business.phone,
  email: business.email,
  address: { '@type': 'PostalAddress', ...business.address },
  openingHours: business.openingHours,
  logo: `${business.url}/icon-512.png`,
  image: `${business.url}/icon-512.png`,
  sameAs: business.sameAs,
  // Made in Los Angeles and Cleveland, shipped to every US state.
  areaServed: [
    { '@type': 'Country', name: 'United States' },
    { '@type': 'City', name: 'Los Angeles', containedInPlace: { '@type': 'State', name: 'California' } },
    { '@type': 'City', name: 'Cleveland', containedInPlace: { '@type': 'State', name: 'Ohio' } },
  ],
};
