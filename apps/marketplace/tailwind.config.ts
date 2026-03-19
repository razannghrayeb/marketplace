import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Fashion AI palette: warm, editorial, inviting
        cream: {
          50: '#FFFDF9',
          100: '#FDF8F3',
          200: '#F5EDE4',
          300: '#E8DDD2',
        },
        charcoal: {
          50: '#F5F5F5',
          100: '#E5E5E5',
          200: '#A3A3A3',
          300: '#737373',
          400: '#525252',
          500: '#404040',
          600: '#262626',
          700: '#1A1A1A',
          800: '#141414',
          900: '#0A0A0A',
        },
        wine: {
          50: '#FDF2F4',
          100: '#FCE7EB',
          200: '#F9D0D9',
          300: '#F4A9B8',
          400: '#EC7A94',
          500: '#E04D6F',
          600: '#C92F55',
          700: '#722F37', // primary accent
          800: '#5C262C',
          900: '#4A1F24',
        },
        gold: {
          50: '#FDF9F0',
          100: '#FAF0D9',
          200: '#F5E1B8',
          300: '#E8C97A',
          400: '#D4A84B',
          500: '#C9A86C', // rose gold / copper accent
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
        'soft': '0 4px 20px -2px rgba(0,0,0,0.06), 0 2px 8px -2px rgba(0,0,0,0.04)',
        'elevated': '0 12px 40px -8px rgba(0,0,0,0.12), 0 4px 12px -4px rgba(0,0,0,0.06)',
        'glow': '0 0 40px -10px rgba(114, 47, 55, 0.3)',
      },
    },
  },
  plugins: [],
}

export default config
