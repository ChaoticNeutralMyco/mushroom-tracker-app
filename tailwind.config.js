<<<<<<< HEAD
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx,html}"
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
=======
// tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
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
>>>>>>> be7d1a18 (Initial commit with final polished version)
