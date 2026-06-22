import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // AXIOM terminal palette
        base: '#0a0a0f',
        panel: '#12121a',
        'panel-raised': '#181822',
        edge: '#23232f',
        muted: '#7a7a8c',
        buy: '#00ff88',
        'buy-dim': '#0a3d28',
        sell: '#ff4444',
        'sell-dim': '#3d1414',
        accent: '#5b8cff',
        warn: '#ffb020',
        alarm: '#ff2d55',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        pulseRow: {
          '0%': { backgroundColor: 'rgba(91,140,255,0.25)' },
          '100%': { backgroundColor: 'transparent' },
        },
        alarmBorder: {
          '0%,100%': { borderColor: '#ff2d55' },
          '50%': { borderColor: '#ffb020' },
        },
      },
      animation: {
        pulseRow: 'pulseRow 1s ease-out',
        alarmBorder: 'alarmBorder 0.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
