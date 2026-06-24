/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Enables src/instrumentation.ts (server startup hook).
    instrumentationHook: true,
  },
  // @breezystack/lamejs is an ESM-only package ("type":"module") and must be
  // transpiled by Next.js/SWC so webpack can bundle it for the browser.
  transpilePackages: ['@breezystack/lamejs'],
}

export default nextConfig
