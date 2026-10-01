import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendPort = process.env.PI_LIVECRAFT_BACKEND_PORT ?? '43121'
const frontendPort = process.env.PI_LIVECRAFT_FRONTEND_PORT ?? '5173'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Pinned: the backend's request guard allows exactly this origin, so a silently
    // shifted port would surface as 403s far from the cause.
    port: Number(frontendPort),
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${backendPort}`,
    },
  },
})
