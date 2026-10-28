import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // The vendored canvas engine ships TypeScript source.
  transpilePackages: ["ascii-sharks"],
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
