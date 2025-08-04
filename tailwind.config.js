// tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx,html}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        pastel: {
          bg: "#fef6fb",
          card: "#ffeaf1",
          text: "#542c3e",
        },
        contrast: {
          bg: "#000000",
          card: "#1a1a1a",
          text: "#ffffff",
        },
      },
    },
  },
  plugins: [],
};
