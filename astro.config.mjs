// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Static build. Every URL keeps the trailing slash WordPress used, so existing
// rankings carry over without a redirect.
export default defineConfig({
  site: 'https://thebestscreenprinting.com',
  trailingSlash: 'always',
  // Styles go inside each page: no stylesheet request to wait for, so Firefox never paints unstyled.
  build: { format: 'directory', inlineStylesheets: 'always' },
  integrations: [
    sitemap({
      filter: (page) => !['/thank-you/', '/quote-cart/', '/order/thanks/', '/track/'].some((p) => page.includes(p)),
    }),
  ],
});
