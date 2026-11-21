import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [uni()],
  server: {
    proxy: {
      "/api/v1": {
        // MBTI_WEB_API_ORIGIN lets a local dev server target the local API without editing this file.
        target: process.env.MBTI_WEB_API_ORIGIN || "https://mbti-dev.bestshizhongyu.com",
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
