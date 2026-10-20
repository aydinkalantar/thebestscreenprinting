import type { Config } from 'tailwindcss';
import { tailwindPreset } from './src/styles/tailwind.preset';

// Same preset as the studio, so a class means the same thing in both apps.
export default {
  presets: [tailwindPreset],
  darkMode: 'class',
  content: ['./src/**/*.{astro,ts,tsx,md,mdx}'],
} satisfies Config;
