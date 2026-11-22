/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        heading: ['Space Grotesk', 'Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        primary: '#6366f1',
        accent: '#8b5cf6',
      },
      boxShadow: {
        '2xs': '0 1px 2px rgba(0, 0, 0, 0.05)',
        '3xs': '0 1px 1px rgba(0, 0, 0, 0.04)',
      },
      borderColor: {
        150: '#e6e9ef',
        250: '#d9dee8',
        450: '#6b7280',
      },
      textColor: {
        150: '#e2e8f0',
        650: '#4b5563',
        705: '#374151',
      },
    },
  },
  plugins: [],
};
