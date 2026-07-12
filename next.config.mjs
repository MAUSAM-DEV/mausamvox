/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Enables src/instrumentation.ts (server startup hook).
    instrumentationHook: true,
    // These packages resolve assets via __dirname / filesystem paths at
    // runtime (ffmpeg binary, Basic Pitch model files, tfjs .wasm, Emscripten
    // libfluidsynth); bundling them would break those paths, so keep them
    // external to the server bundle.
    serverComponentsExternalPackages: [
      'ffmpeg-static',
      '@tensorflow/tfjs',
      '@tensorflow/tfjs-backend-wasm',
      '@spotify/basic-pitch',
      '@tonejs/midi',
      'js-synthesizer',
    ],
    // Belt-and-braces: make sure Vercel's file tracing ships non-JS assets
    // read via computed fs paths (nft can't statically trace those). Each
    // route degrades or errors loudly if an asset is still missing at runtime.
    outputFileTracingIncludes: {
      '/api/prepare-dataset': ['./node_modules/ffmpeg-static/ffmpeg*'],
      '/api/choir': ['./node_modules/ffmpeg-static/ffmpeg*'],
      '/api/instruments': [
        './node_modules/ffmpeg-static/ffmpeg*',
        './node_modules/@spotify/basic-pitch/model/**',
        './node_modules/@tensorflow/tfjs-backend-wasm/dist/*.wasm',
        './assets/soundfonts/GeneralUserGS.sf2',
      ],
    },
  },
  // @breezystack/lamejs is an ESM-only package ("type":"module") and must be
  // transpiled by Next.js/SWC so webpack can bundle it for the browser.
  transpilePackages: ['@breezystack/lamejs'],
}

export default nextConfig
