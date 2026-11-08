/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        barrio: {
          green: '#1F7A5C',
          'green-dark': '#155A43',
          'green-soft': '#DDF0E8',
          ink: '#1E2A26',
          muted: '#4F5F58',
          canvas: '#F6F4EE',
          border: '#D8D4C6',
        },
      },
    },
  },
  plugins: [],
};
