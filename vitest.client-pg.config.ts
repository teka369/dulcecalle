import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
    include: ["e2e/**/*.test.ts"],
    fileParallelism: false,
    hookTimeout: 180000,
    testTimeout: 180000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
