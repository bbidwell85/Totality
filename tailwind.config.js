/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/renderer/index.html",
    "./src/renderer/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "fade-out": {
          from: { opacity: "1" },
          to: { opacity: "0" },
        },
        "slide-in-from-top": {
          from: { transform: "translateY(calc(-1 * var(--slide-offset, 1rem)))" },
          to: { transform: "translateY(0)" },
        },
        "slide-in-from-bottom": {
          from: { transform: "translateY(var(--slide-offset, 1rem))" },
          to: { transform: "translateY(0)" },
        },
        "slide-in-from-left": {
          from: { transform: "translateX(calc(-1 * var(--slide-offset, 1rem)))" },
          to: { transform: "translateX(0)" },
        },
        "slide-in-from-right": {
          from: { transform: "translateX(var(--slide-offset, 1rem))" },
          to: { transform: "translateX(0)" },
        },
        "zoom-in": {
          from: { transform: "scale(var(--zoom-scale, 0.95))" },
          to: { transform: "scale(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in var(--animation-duration, 500ms) var(--animation-timing, ease-out)",
        "fade-out": "fade-out var(--animation-duration, 500ms) var(--animation-timing, ease-out)",
        "slide-in-from-top": "slide-in-from-top var(--animation-duration, 500ms) var(--animation-timing, ease-out)",
        "slide-in-from-bottom": "slide-in-from-bottom var(--animation-duration, 500ms) var(--animation-timing, ease-out)",
        "slide-in-from-left": "slide-in-from-left var(--animation-duration, 500ms) var(--animation-timing, ease-out)",
        "slide-in-from-right": "slide-in-from-right var(--animation-duration, 500ms) var(--animation-timing, ease-out)",
        "zoom-in": "zoom-in var(--animation-duration, 500ms) var(--animation-timing, ease-out)",
      },
    },
  },
  plugins: [],
}
