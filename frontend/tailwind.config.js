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
          surface: '#0D1117',
          'surface-light': '#161B22',
          border: '#30363D',
          text: '#C9D1D9',
          'text-muted': '#8B949E',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px #2A5ADA, 0 0 10px #2A5ADA' },
          '100%': { boxShadow: '0 0 10px #00D4FF, 0 0 20px #00D4FF' },
        },
      },
    },
  },
  plugins: [],
};
