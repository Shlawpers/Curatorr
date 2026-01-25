/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        plex: {
          gold: '#e5a00d',
          orange: '#cc7b19',
          dark: '#1f1f1f',
          darker: '#181818',
          card: '#282828',
          border: '#3f3f3f',
        },
      },
    },
  },
  plugins: [],
}
