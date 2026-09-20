import { spawnSync } from "node:child_process";
import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

const revision =
  spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout?.trim() ||
  crypto.randomUUID();

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  additionalPrecacheEntries: [
    { url: "/", revision },
    { url: "/offline", revision },
    { url: "/manifest.webmanifest", revision },
    { url: "/icons/icon-192.png", revision },
    { url: "/icons/icon-512.png", revision },
  ],
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Same-origin /v1 → Nest. Dev/preview only.
    // Production uses NEXT_PUBLIC_API_URL; never proxy to loopback.
    if (process.env.NEXT_PUBLIC_API_URL) return [];
    if (process.env.NODE_ENV !== "development") return [];
    return [
      {
        source: "/v1/:path*",
        destination: "http://127.0.0.1:3000/v1/:path*",
      },
    ];
  },
};

export default withSerwist(nextConfig);
