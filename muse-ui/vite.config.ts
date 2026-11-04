import { defineConfig } from "vitest/config";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

// Baseline stack: React + TypeScript + Vite. No CDN application libraries;
// every dependency is bundled from npm (see package.json + package-lock.json).
// Tailwind v4 is the styling/token utility layer for application chrome only;
// MapLibre and Three.js keep owning their visualization canvases.
export default defineConfig({
  plugins: [tailwindcss(), react()],
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
