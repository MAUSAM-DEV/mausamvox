# Soundfonts

`GeneralUserGS.sf2` — **GeneralUser GS v2.0.3** by S. Christian Collins
(https://www.schristiancollins.com), obtained from its official repository
https://github.com/mrbumpy409/GeneralUser-GS (32.3 MB, full 128-program
General MIDI bank). Used by `/api/instruments` to render Basic Pitch MIDI
through js-synthesizer (WASM FluidSynth). Shipped with the function via
`outputFileTracingIncludes` in next.config.mjs.

## License (verified 2026-07-12 from documentation/LICENSE.txt in the repo)

GeneralUser GS License v2.0 — exact terms of the complete work:

> "You may use GeneralUser GS without restriction for your own music creation,
> private or commercial. This SoundFont bank is provided to the community free
> of charge. Please feel free to use it in your software projects, and to
> modify the SoundFont bank or its packaging to suit your needs."

On the contained samples:

> "GeneralUser GS inherits the usage rights of the samples contained within,
> all of which allow full use in music production, including the ability to
> make profit from musical recordings created with GeneralUser GS."

The license also asks distributors not to hotlink the author's download files
but to "provide your own local copy instead" — which is exactly what this
directory is.

Author's honest caveat (quoted so we carry it forward): some samples came from
free SoundFont sites decades ago, so the author "cannot be 100% sure where all
of the samples originated," though no ownership complaint has been made since
2000 and the bank is widely used in commercial software.

## History

Replaced `TimGM6mb.sf2` (GPLv2) on 2026-07-12 — GPL was a poor fit for a
bundled asset in a commercial product. All 32 GM programs exposed in
`src/lib/instruments.ts` were re-verified present in this bank (phdr parse).
