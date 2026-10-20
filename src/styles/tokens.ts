// COPY of packages/config/src/tokens.ts in aydinkalantar/Virtual-Promo (the studio),
// which is the source of truth. Change it there, then copy it here.
/**
 * TBSP design tokens for JavaScript consumers (Tailwind preset, charts, emails).
 * Keep in sync with tokens.css — the CSS file is what pages actually load.
 */
export const tokens = {
  accent: { DEFAULT: '#7c3aed', hover: '#6d28d9', glow: '#a78bfa', muted: '#7c3aed1a' },
  surface: { light: '#ffffff', dark: '#0a0a0f', 'dark-elevated': '#0d0d14' },
  font: {
    sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
    display: ['Outfit', 'Inter', 'system-ui', 'sans-serif'],
  },
  /** The studio and public site both use Lucide icons (lucide-react / @lucide/astro). */
  iconSet: 'lucide',
} as const;
