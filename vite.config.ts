import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// base './' keeps asset URLs relative so the build works on the
// /reverse-shot-planner/ GitHub Pages subpath (no client-side router).
export default defineConfig({
  base: './',
  plugins: [react()],
})
