/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Enables src/instrumentation.ts (server startup hook).
    instrumentationHook: true,
  },
  webpack: (config, { isServer, nextRuntime }) => {
    if (isServer && nextRuntime !== 'edge') {
      // Don't let webpack bundle undici — it imports node: scheme modules
      // (e.g. node:console via mock-agent) that the bundler can't process.
      // Externalize it so it's loaded with a native require() at runtime.
      config.externals = config.externals || []
      if (Array.isArray(config.externals)) {
        config.externals.push({ undici: 'commonjs undici' })
      }
    }
    return config
  },
}

export default nextConfig
