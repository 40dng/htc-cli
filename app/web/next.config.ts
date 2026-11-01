import type { NextConfig } from "next";

const config: NextConfig = {
  output: "export",
  distDir: "out",
  reactStrictMode: true,
  // o backend (src/server/web.ts) responde /api/*; o build e estatico
  assetPrefix: "./",
};

export default config;
