import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // relative base so the build works both on GitHub Pages
  // (served under /pickleball-score-counter/) and any static host
  base: './',
});
