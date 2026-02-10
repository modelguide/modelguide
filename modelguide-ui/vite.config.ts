import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig, loadEnv } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import { devAutoLogin } from './plugins/dev-auto-login'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    server: {
      port: 3001,
    },
    plugins: [
      ...(env.VITE_DEV_AUTO_LOGIN_EMAIL ? [devAutoLogin(env.VITE_DEV_AUTO_LOGIN_EMAIL)] : []),
      tailwindcss(),
      tsConfigPaths({
        projects: ['./tsconfig.json'],
      }),
      tanstackStart({
        srcDirectory: 'src',
      }),
      viteReact(),
      nitro({
        devProxy: {
          '/api/**': { target: 'http://localhost:3000' },
        },
      }),
    ],
  }
})
