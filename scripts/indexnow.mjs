// Tells Bing (and through it ChatGPT search and Copilot), Yandex and others about new or changed URLs.
// Run after a production deploy:  node scripts/indexnow.mjs            (every URL in the sitemap)
//                                 node scripts/indexnow.mjs /a/ /b/    (just these paths)
// The key file lives at public/<key>.txt; IndexNow checks it before accepting the list.
import { readdirSync, readFileSync } from 'node:fs';

const host = 'thebestscreenprinting.com';
const keyFile = readdirSync('public').find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) throw new Error('No IndexNow key file in public/');
const key = readFileSync(`public/${keyFile}`, 'utf8').trim();

let urls = process.argv.slice(2).map((p) => `https://${host}${p}`);
if (!urls.length) {
  const index = await (await fetch(`https://${host}/sitemap-index.xml`)).text();
  for (const sm of index.match(/<loc>[^<]+<\/loc>/g) ?? []) {
    const xml = await (await fetch(sm.slice(5, -6))).text();
    urls.push(...(xml.match(/<loc>[^<]+<\/loc>/g) ?? []).map((l) => l.slice(5, -6)));
  }
}

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host, key, keyLocation: `https://${host}/${keyFile}`, urlList: urls.slice(0, 10000) }),
});
console.log(`IndexNow: ${res.status} ${res.statusText} for ${urls.length} URLs`);
if (res.status >= 400) process.exit(1);
