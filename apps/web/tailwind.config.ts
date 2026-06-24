import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // AXIOM "Exactly-Once" palette — Bloomberg-light editorial. Warm paper,
        // near-black ink, a deep amber accent, and buy/sell tuned to read
        // confidently on a LIGHT surface (neon greens vanish on white).
        base: '#F6F3EC', // warm paper — the page
        panel: '#FFFFFF', // card surface
        'panel-raised': '#F1ECE1', // inset / hover wells, header strips
        edge: '#E4DDCF', // hairline rules between regions
        'edge-strong': '#CFC6B4', // stronger dividers / card borders
        muted: '#8A8170', // secondary ink (warm gray)
        // Buy/sell: deep, saturated, legible on paper.
        buy: '#0E8F5E', // forest green
        'buy-dim': 'rgba(14,143,94,0.10)',
        sell: '#C8324B', // crimson
        'sell-dim': 'rgba(200,50,75,0.10)',
        // Amber-gold brand accent (the diamond ledger core), darkened for light bg.
        accent: '#B8852A',
        'accent-deep': '#8A6116',
        warn: '#B8852A',
        alarm: '#C8324B',
        ink: '#1A1712', // near-black warm ink — primary text
        'ink-soft': '#4A4337', // softened ink for body copy
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        sans: ['Hanken Grotesk', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['Newsreader', 'ui-serif', 'Georgia', 'serif'],
      },
      keyframes: {
        pulseRow: {
          '0%': { backgroundColor: 'rgba(184,133,42,0.22)' },
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
