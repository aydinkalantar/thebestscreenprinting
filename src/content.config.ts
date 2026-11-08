import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { fill } from './lib/facts.mjs';

// Text that may hold {{price}} tokens from src/data/facts.json.
const text = () => z.string().transform((v) => fill(v));

// One Markdown file per kept URL. `path` is the exact public URL (with trailing
// slash) so pages keep the address Google already knows.
const pages = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/pages' }),
  schema: z.object({
    path: z.string().regex(/^\/(.*\/)?$/),
    title: text(),
    description: text().default(''),
    h1: text(),
    kind: z.enum(['core', 'service', 'product', 'audience', 'location', 'blog', 'legal', 'utility', 'answer']).default('core'),
    // Imported verbatim from WordPress and not yet rewritten.
    imported: z.boolean().default(false),
    noindex: z.boolean().default(false),
    // Answer-first block shown under the H1 (what, who, price, minimum, turnaround).
    summary: text().optional(),
    facts: z.array(z.object({ label: text(), value: text() })).default([]),
    // Rendered as an FAQ section and FAQPage schema.
    faqs: z.array(z.object({ q: text(), a: text() })).default([]),
    // Legal pages: date shown as "Last updated" (YYYY-MM-DD).
    updated: z.string().optional(),
    sourceUrl: z.string().optional(),
    // Regional pages: the states this page serves (schema areaServed).
    states: z.array(z.string()).default([]),
  }),
});

export const collections = { pages };
