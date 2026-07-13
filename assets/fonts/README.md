# Bundled fonts

## NotoSans-Regular.ttf

- **Font:** Noto Sans Regular (v27, latin subset)
- **License:** SIL Open Font License 1.1 — free for commercial use, embedding
  and redistribution. Full text: https://openfontlicense.org
- **Provenance:** copied unmodified from `next/dist/compiled/@vercel/og/`
  (the same file Next.js ships for its OG-image renderer) rather than
  depending on that internal path, which can move across Next upgrades.
- **Used by:** `/api/share-video` — ffmpeg's `drawtext` filter needs a real
  font file on disk for the text overlays on the shareable social video.
  Shipped to the lambda via `outputFileTracingIncludes` in `next.config.mjs`.
