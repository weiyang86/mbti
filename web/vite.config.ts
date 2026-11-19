import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [uni()],
  server: {
    proxy: {
      "/api/v1": {
        target: "https://mbti-dev.bestshizhongyu.com",
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
