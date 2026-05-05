import type { Config } from 'tailwindcss'

const config: Config = {
  /** Include CSS so utilities used only via `@apply` in `globals.css` are generated (e.g. `text-btn`). */
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}', './src/**/*.css'],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'Times New Roman', 'serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        /** Align with globals typography scale */
        body: ['16px', { lineHeight: '1.5' }],
        small: ['13px', { lineHeight: '1.45' }],
        nav: ['15px', { lineHeight: '1.45' }],
        product: ['16px', { lineHeight: '1.35' }],
        btn: ['14px', { lineHeight: '1.35' }],
      },
      colors: {
        /** Luxury editorial palette */
        ink: '#2B2521',
        muted: '#6F6258',
        accent: '#7A4E3A',
        page: '#F5F1EC',
        /** Primary UI — button & CTA charcoal */
        brand: {
          DEFAULT: '#3d3030',
          hover: '#504545',
          active: '#2c2424',
          muted: '#ede8e4',
        },
        neutral: {
          25: '#FCFCFC',
          50: '#FAFAFA',
          100: '#F5F5F5',
          150: '#EFEFEF',
          200: '#E5E5E5',
          300: '#D4D4D4',
          400: '#A3A3A3',
          500: '#737373',
          600: '#525252',
          700: '#404040',
          800: '#262626',
          850: '#1A1A1A',
          900: '#111111',
          950: '#0A0A0A',
        },
        violet: {
          50: '#F5F3FF',
          100: '#EDE9FE',
          200: '#DDD6FE',
          300: '#C4B5FD',
          400: '#A78BFA',
          500: '#8B5CF6',
          600: '#7C3AED',
          700: '#6D28D9',
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out',
        'slide-up': 'slideUp 0.5s ease-out',
        'float': 'float 6s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      },
      boxShadow: {
        soft: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        card: '0 1px 3px rgba(0,0,0,0.08), 0 4px 16px -4px rgba(0,0,0,0.06)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.1), 0 8px 32px -8px rgba(0,0,0,0.08)',
        elevated: '0 8px 30px -8px rgba(0,0,0,0.12)',
      },
    },
  },
  plugins: [],
}

export default config
