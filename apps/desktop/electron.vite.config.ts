import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const directory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ["@maestro/contracts", "@maestro/core", "@maestro/database"],
      }),
    ],
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          index: path.join(directory, "src/main/index.ts"),
          "context-worker": path.join(directory, "src/main/context-worker.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ["@maestro/contracts", "@maestro/contracts/ipc-channels"],
      }),
    ],
    build: {
      sourcemap: true,
      rollupOptions: {
        input: path.join(directory, "src/preload/index.ts"),
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    root: path.join(directory, "src/renderer"),
    resolve: {
      alias: {
        "@renderer": path.join(directory, "src/renderer/src"),
      },
    },
    plugins: [react(), tailwindcss()],
    build: { sourcemap: true },
  },
});
