import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "MyWorkshop",
        short_name: "MyWorkshop",
        description: "Inventaire de l'atelier",
        theme_color: "#1f2937",
        background_color: "#f8fafc",
        display: "standalone",
        start_url: "/",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ["**/*.{js,css,html,svg,ico,png,webmanifest}"],
        // Lecture hors ligne : le réseau d'abord, la dernière réponse connue seulement s'il ne répond pas.
        // Rien n'est servi depuis le cache tant que le serveur répond.
        runtimeCaching: [
          {
            urlPattern: ({ url, request }: { url: URL; request: Request }) =>
              request.method === "GET" &&
              url.pathname.startsWith("/api/v1/") &&
              !/^\/api\/v1\/(auth|export|health)/.test(url.pathname),
            handler: "NetworkFirst",
            options: {
              cacheName: "mw-api-lecture",
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 400, maxAgeSeconds: 7 * 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
});
