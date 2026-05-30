import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        cyber: {
          bg:      '#080C14',
          surface: '#0D1421',
          panel:   '#111827',
          cyan:    '#00F5FF',
          amber:   '#F59E0B',
          crimson: '#EF4444',
          slate:   '#1E293B',
        },
      },
      fontFamily: {
        orbitron: ['Orbitron', 'JetBrains Mono', 'monospace'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        'glow-cyan':   '0 0 12px 2px rgba(0,245,255,0.4), 0 0 4px rgba(0,245,255,0.6)',
        'glow-amber':  '0 0 12px 2px rgba(245,158,11,0.4)',
        'glow-red':    '0 0 12px 2px rgba(239,68,68,0.4)',
      },
      borderColor: {
        'cyber-cyan/6':  'rgba(0,245,255,0.06)',
        'cyber-cyan/12': 'rgba(0,245,255,0.12)',
      },
      keyframes: {
        pulse_ring: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.3' } },
        strobe:     { '0%,100%': { opacity: '1' }, '50%': { opacity: '0' } },
        glow_sweep: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'pulse-ring': 'pulse_ring 2s ease-in-out infinite',
        'strobe':     'strobe 0.5s step-end infinite',
        'glow-sweep': 'glow_sweep 3s linear infinite',
      },
    },
  },
  plugins: [],
}

export default config
