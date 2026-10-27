// Product id → [slug, name, image] for Max's chat: his placement cards name a product by id, and
// "See it" needs its page. Loaded only when such a card shows.
import { products } from '../lib/catalog';

export function GET() {
  const map = Object.fromEntries(products.map((p) => [p.id, [p.slug, p.name, p.image || '']]));
  return new Response(JSON.stringify(map), { headers: { 'content-type': 'application/json' } });
}
