import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ptc-api': {
        target: 'https://api.powertochoose.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ptc-api/, ''),
      },
    },
  },
})
