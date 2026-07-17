import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
import { loadEnv } from 'vite'

export default defineWorkersConfig(({ mode }) => {
  const testEnv = loadEnv(mode, process.cwd(), '')
  for (const key of ['NUXT_CF_API_TOKEN', 'NUXT_SITE_TOKEN']) {
    if (process.env[key])
      testEnv[key] = process.env[key]
  }

  return {
    test: {
      env: testEnv,
      poolOptions: {
        workers: {
          singleWorker: true,
          isolatedStorage: false,
          wrangler: {
            configPath: './wrangler.jsonc',
          },
          miniflare: {
            cf: true,
            bindings: testEnv,
          },
        },
      },
    },
  }
})
