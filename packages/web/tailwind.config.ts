/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        fina: {
          blue: 'hsl(var(--fina-blue))',
          'blue-hover': 'hsl(var(--fina-blue-hover))',
          bg: 'hsl(var(--fina-bg))',
          sidebar: 'hsl(var(--fina-sidebar))',
          hover: 'hsl(var(--fina-hover))',
          active: 'hsl(var(--fina-active))',
          'active-text': 'hsl(var(--fina-active-text))',
          border: 'hsl(var(--fina-border))',
          text: 'hsl(var(--fina-text))',
          'text-secondary': 'hsl(var(--fina-text-secondary))',
          'text-tertiary': 'hsl(var(--fina-text-tertiary))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"PingFang SC"', '"Noto Sans SC"', '"Helvetica Neue"', '"Microsoft YaHei"', '"Source Han Sans SC"', 'sans-serif'],
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};