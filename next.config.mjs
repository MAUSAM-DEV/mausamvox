/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Enables src/instrumentation.ts (server startup hook).
    instrumentationHook: true,
  },
}

export default nextConfig
