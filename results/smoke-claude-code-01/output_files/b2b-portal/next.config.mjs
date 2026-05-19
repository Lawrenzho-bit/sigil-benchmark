/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output produces a minimal server bundle for the container image.
  output: "standalone",
  poweredByHeader: false,
};

export default nextConfig;
