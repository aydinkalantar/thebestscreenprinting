// /llms.txt: a plain-text summary of TBSP for answer engines (ChatGPT, Gemini, Copilot, Perplexity).
// Facts come from business.ts; the page list is every indexable answer, service and audience page.
import { getCollection } from 'astro:content';
import { business } from '../data/business';
import { fill } from '../lib/facts.mjs';

const SECTIONS: { title: string; kinds: string[] }[] = [
  { title: 'Straight answers (prices, minimums, turnaround)', kinds: ['answer'] },
  { title: 'Services', kinds: ['service'] },
  { title: 'Products', kinds: ['product'] },
  { title: 'Who we print for', kinds: ['audience'] },
  { title: 'Ordering, shipping and policies', kinds: ['core'] },
];

export async function GET() {
  const pages = (await getCollection('pages')).filter((p) => !p.data.noindex && !p.data.imported);
  const line = (p: (typeof pages)[number]) => `- [${p.data.h1}](${business.url}${p.data.path}): ${p.data.description}`;
  const [normal, rush, superRush] = business.turnaround;
  const body = [
    `# ${business.name} (${business.shortName})`,
    '',
    `> Custom screen printing, embroidery, DTF and DTG on t-shirts, hoodies, hats, polos and bags. Made in our own production facilities in Los Angeles, California and Cleveland, Ohio, and shipped to every US state, free on orders of $${business.shippingFreeFrom} or more.`,
    '',
    '## Key facts',
    `- Minimum order: ${business.screenMinimum} pieces for screen printing (1 to 3 colors) and embroidery; ${business.shopMinimum} pieces for DTG and DTF. Screen printing with 4 or more colors starts at 50, embossing at 24.`,
    `- Turnaround: ${normal.name} ${normal.time.toLowerCase()}; ${rush.name} ${rush.time} (${rush.fee}); ${superRush.name} ${superRush.time} (${superRush.fee}).`,
    `- Shipping: free on orders of $${business.shippingFreeFrom} or more, $${business.shippingFlat} flat below that, anywhere in the lower 48 states; local pickup in Los Angeles.`,
    fill('- Example price: one-color screen print on a black tee, shirt included, about {{tee.screen1.24}} each at 24 pieces and {{tee.screen1.144}} each at 144, plus a {{screenSetup}} screen. Full-color DTF about {{tee.dtf.24}} each at 24.'),
    fill('- Embroidery digitizing free from {{digitizingFreeFrom}} pieces ({{digitizing}} per logo below that).'),
    '- We print with plastisol ink (standard, soft-hand, metallic and glitter). We do not offer water-based or discharge ink, sublimation, all-over prints, patches, rhinestones or woven labels.',
    '- Free art check and a mockup to approve before anything is printed.',
    `- Quotes: ${business.url}/quick-quote/ or ${business.email} or ${business.phoneDisplay}. Reply within one business day.`,
    `- Walk-in shop: ${business.address.streetAddress}, ${business.address.addressLocality}, ${business.address.addressRegion} ${business.address.postalCode}. Mon–Fri 9am–5pm.`,
    '',
    ...SECTIONS.flatMap((s) => {
      const list = pages.filter((p) => s.kinds.includes(p.data.kind) && p.data.path !== '/').sort((a, b) => a.data.path.localeCompare(b.data.path));
      return list.length ? [`## ${s.title}`, ...list.map(line), ''] : [];
    }),
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
