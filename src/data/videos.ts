// Videos from the TBSP YouTube channel (youtube.com/@Thebestscreenprinting),
// and which pages show them. `uploaded` is set where known; VideoObject schema
// is only emitted for videos with a date.

export interface Video { id: string; title: string; uploaded?: string }

export const VIDEOS: Record<string, Video> = {
  reel: { id: 'MY29tXEXfzc', title: 'TBSP production reel', uploaded: '2018-10-03' },
  netflix: { id: '-s09GNSqCHo', title: 'How we made screen printing for Netflix', uploaded: '2018-08-20' },
  sevenColor: { id: 'LLUjONJno6Y', title: '7-color screen printing' },
  fiveColor: { id: 'DzlF-JuKxUs', title: '5-color screen printing, step by step', uploaded: '2018-02-27' },
  screen: { id: 'eeZU-R1_Ki4', title: 'Screen printing at TBSP' },
  embroidery: { id: 'npP1cLVHizU', title: 'Custom embroidery at TBSP' },
  puffHats: { id: 'I4YbMdR83pE', title: '3D puff embroidery on snapback hats' },
  flatHats: { id: 'THnzA4LE38k', title: 'Flat embroidery on hats' },
  leather: { id: '6-qpXp6o_2o', title: 'Custom embroidery on leather biker jackets', uploaded: '2019-06-04' },
  embossHoodies: { id: 'wV0ylbqt67U', title: 'Custom embossing on sweatshirts and hoodies', uploaded: '2019-08-21' },
  embossMachine: { id: 'mDFHqLYV4ko', title: 'How our garment embossing machine works' },
  dtg: { id: 'x03lqqqZATs', title: 'Direct-to-garment (DTG) printing' },
  dtgBlack: { id: 'WwlgkqVI97g', title: 'DTG printing on a black t-shirt' },
  allOver: { id: 'Uemzh50ODVw', title: 'Custom all-over shirt printing', uploaded: '2019-08-06' },
  sublimation: { id: 'tXYD3vGUZYs', title: 'All-over dye sublimation', uploaded: '2019-08-06' },
  startBrand: { id: 'nBvnMSlK1Xc', title: 'Start your clothing brand with TBSP' },
  mistakes: { id: 'M8MwuihGn1c', title: '5 mistakes to avoid before starting production on a clothing line', uploaded: '2019-10-04' },
  hoodiesVsTees: { id: '-C0CwFNcSQc', title: 'Hoodies vs tees: which makes more money?', uploaded: '2019-09-27' },
  techniques: { id: 'o2TOvOmEQOo', title: '7 unique techniques to level up your brand', uploaded: '2019-10-14' },
};

const v = VIDEOS;
/** Page path → videos shown on it. */
export const PAGE_VIDEOS: Record<string, Video[]> = {
  '/screen-printing/': [v.netflix, v.sevenColor],
  '/services/custom-screen-printing-los-angeles/': [v.techniques, v.screen],
  '/services/custom-screen-printing-los-angeles/silk-screen-printing/': [v.sevenColor, v.fiveColor],
  '/services/embroidery/': [v.embroidery, v.puffHats],
  '/services/embroidery/custom-embroidery/': [v.embroidery],
  '/custom-embroidery-services-los-angeles/': [v.puffHats, v.flatHats],
  '/embroidery-on-clothes/': [v.leather],
  '/products/hats/': [v.flatHats, v.puffHats],
  '/services/embossing/': [v.embossHoodies, v.embossMachine],
  '/services/direct-to-garment/': [v.dtg, v.dtgBlack],
  '/products/t-shirts/custom-all-over-t-shirt-printing-in-los-angeles/': [v.allOver, v.sublimation],
  '/products/t-shirts/custom-all-over-t-shirt-printing-no-minimum/': [v.allOver],
  '/custom-projects/': [v.sublimation, v.embossHoodies],
  '/products/sweatshirts-hoodies/': [v.hoodiesVsTees],
  '/for/retail-brands/': [v.startBrand, v.mistakes],
  '/the-best-screen-printing/': [v.startBrand, v.techniques],
  '/what-is-screen-printing-and-how-is-it-done/': [v.fiveColor],
  '/how-to-do-t-shirt-screen-printing/': [v.fiveColor],
  '/about-us/': [v.reel],
  '/los-angeles-ca/': [v.reel],
};

export function videoJsonLd(video: Video) {
  if (!video.uploaded) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: video.title,
    description: `${video.title} — TBSP`,
    thumbnailUrl: `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
    uploadDate: video.uploaded,
    embedUrl: `https://www.youtube-nocookie.com/embed/${video.id}`,
    contentUrl: `https://www.youtube.com/watch?v=${video.id}`,
  };
}
