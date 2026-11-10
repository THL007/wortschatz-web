import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { resolve } from "node:path";

// GitHub Pages serves the site under /wortschatz-web/
const base = process.env.BASE_PATH ?? "/wortschatz-web/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon.svg", "data/*.json"],
      manifest: {
        name: "Wortschatz: German exam words",
        short_name: "Wortschatz",
        description: "German exam vocabulary by level, most frequent words first, with spaced reviews.",
        lang: "de",
        start_url: `${base}app/`,
        scope: base,
        display: "standalone",
        background_color: "#f7f3e8",
        theme_color: "#f7f3e8",
        icons: [
          { src: `${base}icons/icon-192.png`, sizes: "192x192", type: "image/png" },
          { src: `${base}icons/icon-512.png`, sizes: "512x512", type: "image/png" },
          { src: `${base}icons/icon-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,json}"],
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === "https://api.fontshare.com" || url.origin === "https://cdn.fontshare.com",
            handler: "CacheFirst",
            options: { cacheName: "fonts", expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, "index.html"), app: resolve(import.meta.dirname, "app/index.html") },
    },
  },
});
