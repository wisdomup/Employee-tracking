import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  async redirects() {
    return [
      { source: '/leaves', destination: '/approvals', permanent: true },
      { source: '/leaves/:path*', destination: '/approvals/:path*', permanent: true },
    ];
  },
};

export default nextConfig;
