import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // AXIOM "Exactly-Once" palette — aurora navy + gold, matching the
        // cinematic explainer (AXIOM Exactly-Once.dc.html).
        base: '#070810',
        panel: 'rgba(255,255,255,0.04)',
        'panel-raised': 'rgba(255,255,255,0.06)',
        edge: 'rgba(255,255,255,0.10)',
        muted: '#6E7184',
        // Buy/sell tuned to the explainer's green/rose so the terminal and the
        // story speak the same color language.
        buy: '#4FD89E',
        'buy-dim': 'rgba(79,216,158,0.12)',
        sell: '#F86C84',
        'sell-dim': 'rgba(248,108,132,0.12)',
        // Gold is the brand accent (the diamond ledger core).
        accent: '#E6C892',
        'accent-deep': '#C9A867',
        warn: '#E6C892',
        alarm: '#F86C84',
        ink: '#F2EFE8',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        sans: ['Hanken Grotesk', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['Newsreader', 'ui-serif', 'Georgia', 'serif'],
      },
      keyframes: {
        pulseRow: {
          '0%': { backgroundColor: 'rgba(230,200,146,0.22)' },
          '100%': { backgroundColor: 'transparent' },
        },
        alarmBorder: {
          '0%,100%': { borderColor: '#F86C84' },
          '50%': { borderColor: '#E6C892' },
        },
        drift1: {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '50%': { transform: 'translate(80px,60px) scale(1.2)' },
        },
        drift2: {
          '0%,100%': { transform: 'translate(0,0) scale(1.15)' },
          '50%': { transform: 'translate(-90px,40px) scale(1)' },
        },
        drift3: {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '50%': { transform: 'translate(60px,-70px) scale(1.25)' },
        },
      },
      animation: {
        pulseRow: 'pulseRow 1s ease-out',
        alarmBorder: 'alarmBorder 0.8s ease-in-out infinite',
        drift1: 'drift1 21s ease-in-out infinite',
        drift2: 'drift2 25s ease-in-out infinite',
        drift3: 'drift3 29s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
