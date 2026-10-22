// Small search index for the header search box: pages and catalog products.
import { getCollection } from 'astro:content';
import { products } from '../lib/catalog';

export async function GET() {
  const pages = (await getCollection('pages'))
    .filter((p) => !p.data.noindex && !p.data.path.endsWith('-ca/') && p.data.path !== '/')
    .map((p) => ({ t: p.data.h1, u: p.data.path, k: 'page' }));
  const items = products.map((p) => ({ t: p.name, u: `/catalog/${p.slug}/`, k: 'product', i: p.image }));
  return new Response(JSON.stringify([...items, ...pages]), { headers: { 'content-type': 'application/json' } });
}
