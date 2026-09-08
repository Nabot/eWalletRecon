/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Facebook-inspired light UI (token names kept for existing classes)
        ink: {
          950: "#F0F2F5", // page background
          900: "#FFFFFF", // cards / header
          800: "#E4E6EB", // hover / dividers
          700: "#CED0D4", // borders
        },
        sand: {
          50: "#1C1E21", // primary text
          100: "#050505",
          200: "#4B4F56", // secondary text (stronger contrast)
        },
        veld: {
          400: "#1877F2", // Facebook blue
          500: "#166FE5",
          600: "#1877F2",
          700: "#E7F3FF", // soft blue wash
        },
        clay: {
          400: "#F02849", // FB-style red
          500: "#E41E3F",
          600: "#BE1833",
        },
        amber: {
          warn: "#F7B928",
        },
      },
      fontFamily: {
        display: ['"IBM Plex Sans"', "ui-sans-serif", "sans-serif"],
        sans: ['"IBM Plex Sans"', "ui-sans-serif", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      boxShadow: {
        fb: "0 1px 2px rgba(0, 0, 0, 0.1)",
        "fb-md": "0 2px 12px rgba(0, 0, 0, 0.1)",
      },
    },
  },
  plugins: [],
};
