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
    streetAddress: '2710 S Broadway Avenue',
    addressLocality: 'Los Angeles',
    addressRegion: 'CA',
    postalCode: '90007',
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
  /** Minimum order for every decoration method. Everything is made in-house; we don't decorate fewer. */
  shopMinimum: 12,
  assistantName: 'Max',
  /**
   * Turnaround options shown across the site and offered on the quote form.
   * `time` is filled in once confirmed; until then pages say it's confirmed with the quote.
   */
  turnaround: [
    { id: 'normal', name: 'Normal', time: null as string | null, note: 'Standard production time' },
    { id: 'rush', name: 'Rush', time: null as string | null, note: 'Faster, for tighter deadlines' },
    { id: 'super-rush', name: 'Super Rush', time: null as string | null, note: 'Our fastest option' },
  ],
  /** Areas we serve without a shop address there (service-area business). */
  serviceAreas: ['Los Angeles, CA', 'Cleveland, OH'],
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
  areaServed: [
    { '@type': 'City', name: 'Los Angeles', containedInPlace: { '@type': 'State', name: 'California' } },
    { '@type': 'City', name: 'Cleveland', containedInPlace: { '@type': 'State', name: 'Ohio' } },
  ],
};
