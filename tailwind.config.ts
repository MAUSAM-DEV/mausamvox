import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        void: '#05050F',
        deep: '#0A0A1A',
        surface: '#0F0F22',
        card: '#13132A',
        border: '#2E2E56',
        border2: '#3C3C6A',
        violet: '#9D5CFF',
        pink: '#F9459E',
        cyan: '#0CC7E8',
        green: '#10B981',
        white: '#F0F0FF',
        pearl: '#C8C8E8',
        muted: '#9494BC',
      },
      fontFamily: {
        grotesk: ['"Space Grotesk"', 'sans-serif'],
        inter: ['Inter', 'sans-serif'],
      },
      backgroundImage: {
        'brand-grad': 'linear-gradient(135deg, #9D5CFF, #F9459E, #0CC7E8)',
        'brand-grad2': 'linear-gradient(135deg, #0CC7E8, #9D5CFF, #F9459E)',
      },
      keyframes: {
        orbPulse: {
          '0%, 100%': { transform: 'translate(-50%, -58%) scale(1)' },
          '50%': { transform: 'translate(-50%, -58%) scale(1.08)' },
        },
        blip: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.4', transform: 'scale(0.7)' },
        },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(22px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        orbPulse: 'orbPulse 7s ease-in-out infinite',
        blip: 'blip 2s ease infinite',
        fadeUp: 'fadeUp 0.7s ease both',
      },
    },
  },
  plugins: [],
}

export default config
