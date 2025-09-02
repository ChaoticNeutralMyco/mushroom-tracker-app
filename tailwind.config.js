/** @type {import('tailwindcss').Config} */
module.exports = {
  // IMPORTANT: use the 'dark' class on <html> to switch themes
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      // You can later map your accent via CSS variables if you want
      // and read from document.documentElement.dataset.accent
    },
  },
  plugins: [],
};
