import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const fdKey = (env.VITE_FOOTBALL_API_KEY || '').trim()

  return {
    plugins: [react()],
    server: {
      host: true,
      proxy: {
        '/api/football': {
          target: 'https://api.football-data.org',
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api\/football/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('X-Auth-Token', fdKey)
            })
            proxy.on('error', (err) => console.log('[football proxy error]', err.message))
            proxy.on('proxyRes', (proxyRes, req) => console.log('[football proxy]', req.url, proxyRes.statusCode))
          },
        },
        '/api/odds': {
          target: 'https://api.the-odds-api.com',
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api\/odds/, ''),
          configure: (proxy) => {
            proxy.on('error', (err) => console.log('odds proxy error', err))
            proxy.on('proxyRes', (proxyRes) => console.log('odds proxy status:', proxyRes.statusCode))
          },
        },
      },
    },
  }
})
