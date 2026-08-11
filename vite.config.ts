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
          if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts'
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
