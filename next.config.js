/** @type {import('next').NextConfig} */
const { previewEnabled } = require('./lib/tf-assist/preview-gate');
const nextConfig = {
  env: {
    NEXT_PUBLIC_TF_ASSIST_HARVEST_V1: previewEnabled(process.env) ? '1' : '0',
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: { unoptimized: true },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    return config;
  },
  transpilePackages: [],
  experimental: {
    serverComponentsExternalPackages: [],
  },
};

module.exports = nextConfig;
