// COPY of packages/config/src/tailwind.preset.ts in aydinkalantar/Virtual-Promo (the studio),
// which is the source of truth. Change it there, then copy it here.
import type { Config } from 'tailwindcss';
import { tokens } from './tokens';

const preset: Config = {
  darkMode: 'class',
  content: [],
  theme: {
    extend: {
      fontFamily: {
        sans: [...tokens.font.sans],
        display: [...tokens.font.display],
      },
      fontSize: {
        'display': ['2.25rem', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '700' }],
        'title': ['1.25rem', { lineHeight: '1.3', letterSpacing: '-0.01em', fontWeight: '600' }],
        'body': ['0.875rem', { lineHeight: '1.5', fontWeight: '400' }],
        'caption': ['0.75rem', { lineHeight: '1.4', fontWeight: '500' }],
        'micro': ['0.625rem', { lineHeight: '1.3', fontWeight: '600', letterSpacing: '0.05em' }],
      },
      colors: {
        glass: {
          light: 'rgba(255, 255, 255, 0.12)',
          medium: 'rgba(255, 255, 255, 0.18)',
          heavy: 'rgba(255, 255, 255, 0.25)',
        },
        surface: {
          light: '#f8fafc',
          dark: '#0a0a0f',
          'dark-elevated': '#12121a',
        },
        accent: { ...tokens.accent },
        border: {
          glass: 'rgba(255, 255, 255, 0.15)',
          'glass-strong': 'rgba(255, 255, 255, 0.25)',
        },
        'glass-surface': {
          DEFAULT: '#13131b',
          elevated: '#1a1a25',
          hover: '#22222f',
        },
      },
      boxShadow: {
        glass: '0 8px 32px rgba(0, 0, 0, 0.12)',
        'glass-lg': '0 16px 48px rgba(0, 0, 0, 0.16)',
        'glass-inset': 'inset 0 1px 1px rgba(255, 255, 255, 0.1)',
        'accent-glow': '0 0 40px rgba(124, 58, 237, 0.15)',
        'accent-glow-lg': '0 0 80px rgba(124, 58, 237, 0.2)',
      },
      backdropBlur: {
        glass: '16px',
        'glass-heavy': '24px',
        'glass-ultra': '40px',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out forwards',
        'fade-in-up': 'fadeInUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'slide-in-right': 'slideInRight 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(24px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(124, 58, 237, 0.1)' },
          '50%': { boxShadow: '0 0 40px rgba(124, 58, 237, 0.25)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      borderRadius: {
        'glass': '16px',
        'glass-lg': '24px',
      },
      zIndex: {
        canvas: '0',
        toolbar: '10',
        sidebar: '20',
        overlay: '30',
        modal: '40',
        'agent-takeover': '50',
      },
      transitionTimingFunction: {
        'spring': 'cubic-bezier(0.32, 0.72, 0, 1)',
        'smooth': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
};

export default preset;
export { preset as tailwindPreset };
