import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// One Markdown file per kept URL. `path` is the exact public URL (with trailing
// slash) so pages keep the address Google already knows.
const pages = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/pages' }),
  schema: z.object({
    path: z.string().regex(/^\/(.*\/)?$/),
    title: z.string(),
    description: z.string().default(''),
    h1: z.string(),
    kind: z.enum(['core', 'service', 'product', 'audience', 'location', 'blog', 'legal', 'utility']).default('core'),
    // Imported verbatim from WordPress and not yet rewritten.
    imported: z.boolean().default(false),
    noindex: z.boolean().default(false),
    sourceUrl: z.string().optional(),
  }),
});

export const collections = { pages };
