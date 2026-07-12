/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Enables src/instrumentation.ts (server startup hook).
    instrumentationHook: true,
    // ffmpeg-static resolves its binary via __dirname at runtime; bundling it
    // would break that path, so keep it external to the server bundle.
    serverComponentsExternalPackages: ['ffmpeg-static'],
    // Belt-and-braces: make sure Vercel's file tracing ships the ffmpeg binary
    // with the prepare-dataset function (app-router tracing of binaries inside
    // externalized packages is unreliable). The code degrades to single-clip
    // packaging with a loud log if the binary is still missing at runtime.
    outputFileTracingIncludes: {
      '/api/prepare-dataset': ['./node_modules/ffmpeg-static/ffmpeg*'],
    },
  },
  // @breezystack/lamejs is an ESM-only package ("type":"module") and must be
  // transpiled by Next.js/SWC so webpack can bundle it for the browser.
  transpilePackages: ['@breezystack/lamejs'],
}

export default nextConfig
