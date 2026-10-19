# thebestscreenprinting.com

Public website for The Best Screen Printing (TBSP), Downtown Los Angeles.
Static [Astro](https://astro.build) site served by a Cloudflare Worker.

The design studio, customer accounts and admin are a separate app
(`aydinkalantar/Virtual-Promo`) at https://design.thebestscreenprinting.com.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Local dev server |
| `npm run build` | Builds the redirect table and the static site into `dist/` |
| `npm run preview` | Runs the built site through the Worker (`wrangler dev`) |
| `npm run check:redirects` | Checks every old WordPress URL against a running preview |
| `npm run import:wp` | Re-imports kept pages from the live WordPress site |

## How it fits together

- `src/content/pages/*.md` — one file per page; `path` is the exact public URL.
  Pages with `imported: true` still carry WordPress copy and need rewriting.
- `data/redirect-map.csv` — every old URL with its action (keep, 301, 410).
  `scripts/build-redirects.mjs` turns it into `src/redirects.json`.
- `src/worker.ts` — serves the static files, answers legacy URLs with 301/410,
  redirects www to the apex, and adds `noindex` while `STAGING` is `"1"`.
- `src/styles/tokens.css` — copy of the studio's design tokens (see its header).
- `scripts/gsc-pull.mjs` + `scripts/seo-report.mjs` — weekly Search Console
  report. The service-account key lives outside the repo.

## Deploy (Cloudflare)

- Staging: `npx wrangler deploy` (noindexed, on a workers.dev URL).
- Production: `npx wrangler deploy --env production` once DNS for
  thebestscreenprinting.com is on Cloudflare. Then run the redirect check
  against the live domain.
