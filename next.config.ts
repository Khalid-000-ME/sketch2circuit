import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // A phone loading the dev server by its LAN address is a cross-origin request
  // as far as Next is concerned. Private ranges only: nothing public is allowed.
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '172.*.*.*'],
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
