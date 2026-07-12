# Soundfonts

`TimGM6mb.sf2` — Tim Brechbill's 6 MB General MIDI soundfont, obtained from the
[pretty_midi](https://github.com/craffel/pretty-midi) repository (which bundles
it for the same purpose). Used by `/api/instruments` to render Basic Pitch MIDI
through js-synthesizer (WASM FluidSynth). Shipped with the function via
`outputFileTracingIncludes` in next.config.mjs.

License: TimGM6mb is distributed under the GNU GPL v2 (as packaged in Debian's
`timgm6mb-soundfont`). We use it as an unmodified runtime asset for audio
rendering — revisit licensing if MausamVox's distribution model changes.
