// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Static build. Every URL keeps the trailing slash WordPress used, so existing
// rankings carry over without a redirect.
export default defineConfig({
  site: 'https://thebestscreenprinting.com',
  trailingSlash: 'always',
  build: { format: 'directory' },
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/thank-you/') && !page.includes('/quote-cart/'),
    }),
  ],
});
