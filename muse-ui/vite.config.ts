import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Baseline stack: React + TypeScript + Vite. No CDN application libraries;
// every dependency is bundled from npm (see package.json + package-lock.json).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5200,
  },
  preview: {
    port: 5210,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
