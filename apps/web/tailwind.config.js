/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        hanken: ['var(--font-hanken)', 'sans-serif'],
      },
      colors: {
        // Tenant-themable accent. AuthProvider sets --brand-primary from the
        // tenant's primaryColor; the literal is the house default / fallback.
        primary: 'var(--brand-primary, #3366E3)',
        brand: { navy: '#16335B', blue: '#2563EB', teal: '#0E7490' },
      },
    },
  },
  plugins: [],
}
