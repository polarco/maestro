import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const directory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@renderer": path.join(directory, "src/renderer/src"),
      "@main": path.join(directory, "src/main"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    coverage: {
      reporter: ["text", "html"],
      exclude: ["src/renderer/**"],
    },
  },
});
