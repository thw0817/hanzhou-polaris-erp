import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {
  createV2ReleaseMetadataPlugin,
  escapeHtmlAttribute,
  resolveV2BuildIdentity,
} from "./server/v2-release-manifest.js";

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const isBuild = command === "build";
  const useV2 = isBuild || mode === "v2";
  const v2ApiTarget =
    process.env.VITE_V2_API_TARGET ||
    env.VITE_V2_API_TARGET ||
    "http://127.0.0.1:8790";
  const buildIdentity = useV2
    ? resolveV2BuildIdentity(process.cwd())
    : null;

  return {
    plugins: [
      react(),
      useV2 && tailwindcss(),
      !isBuild && mode === "web" && {
        name: "web-entry",
        transformIndexHtml: {
          order: "pre",
          handler(html) {
            return html.replace("/src/main.jsx", "/src/web-main.jsx");
          },
        },
      },
      useV2 && {
        name: "v2-entry",
        transformIndexHtml: {
          order: "pre",
          handler(html) {
            const markedHtml = html
              .replace("/src/main.jsx", "/src-v2/main.tsx")
              .replace("SHEIN涵舟工作室", "SHEIN超级运营中心");
            if (!buildIdentity) return markedHtml;
            const metadata = [
              `<meta name="polaris-build-id" content="${escapeHtmlAttribute(buildIdentity.buildId)}" />`,
              `<meta name="polaris-source-revision" content="${escapeHtmlAttribute(buildIdentity.sourceRevision)}" />`,
            ].join("\n    ");
            return markedHtml.replace("</head>", `    ${metadata}\n  </head>`);
          },
        },
      },
      isBuild &&
        createV2ReleaseMetadataPlugin({
          root: process.cwd(),
          outDir: "dist-v2",
          identity: buildIdentity,
        }),
    ].filter(Boolean),
    build: {
      outDir: useV2 ? "dist-v2" : "dist-web",
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
