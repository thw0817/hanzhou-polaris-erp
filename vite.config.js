import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const v2ApiTarget =
    process.env.VITE_V2_API_TARGET ||
    env.VITE_V2_API_TARGET ||
    "http://127.0.0.1:8790";

  return {
    plugins: [
      react(),
      mode === "v2" && tailwindcss(),
      mode === "web" && {
        name: "web-entry",
        transformIndexHtml: {
          order: "pre",
          handler(html) {
            return html.replace("/src/main.jsx", "/src/web-main.jsx");
          },
        },
      },
      mode === "v2" && {
        name: "v2-entry",
        transformIndexHtml: {
          order: "pre",
          handler(html) {
            return html
              .replace("/src/main.jsx", "/src-v2/main.tsx")
              .replace("SHEIN涵舟工作室", "SHEIN超级运营中心");
          },
        },
      },
    ].filter(Boolean),
    build: {
      outDir: mode === "web" ? "dist-web" : mode === "v2" ? "dist-v2" : "dist",
      rollupOptions: {
        output: {
          // Keep stable OSS dependencies independently cacheable across V2 UI releases.
          manualChunks: {
            react: ["react", "react-dom", "react-router"],
            query: ["@tanstack/react-query"],
            table: ["@tanstack/react-table", "@tanstack/react-virtual"],
            dnd: ["@dnd-kit/core", "@dnd-kit/sortable", "@dnd-kit/utilities"],
            icons: ["lucide-react"],
          },
        },
      },
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8787",
        },
        "/v1": {
          target: v2ApiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
