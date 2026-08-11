import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// roktolagbe-bd.github.io is an ORGANISATION ROOT SITE, not a project subpath.
// That is why base is '/' and not '/repo-name/'. Do not change this.
export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    reportCompressedSize: true,
    // Warn early if the entry chunk drifts toward the 200kb gzipped budget.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Keep the heavy, rarely-needed code out of the first paint.
        // Leaflet, Recharts and the admin panel must never land in the entry chunk.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('leaflet')) return 'vendor-map'
          // Recharts is deliberately NOT grouped here. Forcing it into a named
          // chunk made Rollup treat it as a static dependency of the entry, and
          // Vite then emitted a modulepreload for it: 107kb gzipped of charting
          // downloaded by every person who opens the landing page needing blood.
          // Left alone, it lands inside the lazy admin chunk where it belongs.
          // Same trap as framer-motion above. Verify with:
          //   grep -o 'assets/[^"]*\.js' dist/index.html
          if (id.includes('@supabase')) return 'vendor-supabase'
          // framer-motion is deliberately NOT grouped here. Forcing it into one
          // chunk would defeat the LazyMotion split in src/lib/motion.tsx and
          // pull the animation features back into first paint.
          if (id.includes('react-router')) return 'vendor-router'
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('scheduler')) {
            return 'vendor-react'
          }
          return
        },
      },
    },
  },
})
