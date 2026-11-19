import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: '/ops/',
  plugins: [vue()],
  server: {
    proxy: {
      '/api': { target: process.env.MBTI_ADMIN_API_ORIGIN || 'http://127.0.0.1:4256', changeOrigin: false },
    },
  },
})
