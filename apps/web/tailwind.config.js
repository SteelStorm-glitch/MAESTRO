/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: 'var(--bg-base)',
        panel: 'var(--bg-panel)',
        elevated: 'var(--bg-elevated)',
        active: 'var(--bg-active)',
        border: 'var(--border)',
        primary: 'var(--text-primary)',
        dim: 'var(--text-dim)',
        faint: 'var(--text-faint)',
        accent: 'var(--accent)',
        danger: 'var(--danger)',
        ok: 'var(--ok)',
        warn: 'var(--warn)',
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
      },
      fontFamily: {
        ui: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      fontSize: {
        ui: ['13px', '18px'],
        code: ['12px', '17px'],
      },
    },
  },
  plugins: [],
}
