import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {},
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "raw.githubusercontent.com",
      },
    ],
  },
  // Bundle the pre-built chart cache into the /api/chart serverless function
  // so Vercel serves warm data on every cold start.
  outputFileTracingIncludes: {
    "/api/chart": [".chart-cache/**/*"],
  },
};

export default nextConfig;
