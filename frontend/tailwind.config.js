/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        chainlink: {
          blue: '#2A5ADA',
          'blue-dark': '#1a3a8f',
          'blue-light': '#4a7ae8',
          accent: '#00D4FF',
          surface: '#0A0E17',
          'surface-light': '#161B22',
          border: '#21293A',
          text: '#C9D1D9',
          'text-muted': '#6B7280',
          purple: '#7C3AED',
          'purple-light': '#9F67FF',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'float': 'float 6s ease-in-out infinite',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px #2A5ADA, 0 0 10px #2A5ADA' },
          '100%': { boxShadow: '0 0 10px #00D4FF, 0 0 20px #00D4FF' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
      },
    },
  },
  plugins: [],
};
