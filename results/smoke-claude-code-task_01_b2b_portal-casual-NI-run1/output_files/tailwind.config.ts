import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dbe6ff',
          500: '#3b6ef5',
          600: '#2d56d4',
          700: '#2444a8',
        },
      },
    },
  },
  plugins: [],
};

export default config;
