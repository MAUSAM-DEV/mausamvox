// Does a song's title look English? The Auto voice engine's last resort (2026-10-23, admin only):
// when the song-language check (Whisper on the lead) hasn't answered within the wait, the page
// judges the uploaded file's name instead — the lyrics aren't known at that moment.
// English = at least half the title's words are common English words (simple endings removed),
// and at least one is. Anything else (romanised Hindi, Devanagari, artist names only) = not English,
// so Auto falls back to Standard — the safer engine for unknown languages.

const COMMON = new Set(`
a about after again all alone always am an and any are around as at away baby back bad be beat beautiful because
been before best better big black blue body boy break breathe bring broken burn but by call can cannot can't change
city close cold come could crazy cry dance dark day dead dear did die do don't down dream drive drop easy end enough
ever every everything eye face fall far feel fire first fly for forever free friend from girl give go gold gone good
got great happy hard have he head heart heaven hell hello her here high hold home hope how i i'm if in inside into is
it it's just keep kill kiss know last late leave let life light like line little live lonely long look lose lost loud
love lover made make man me mind miss moment money moon more morning my need never new next night no nobody not
nothing now of off oh old on one only open or other our out over own paradise people perfect place play please power
rain ready real remember right river road rock run sad same save say sea see shape she should show side sing sky
slow so some someone something song sorry soul sound stand star stay still stop story street summer sun sweet take
talk tear tell than that the their them then there these they thing think this those through till time to together
tonight too touch true try turn up us wait wake walk want war was water way we well what when where while white who
why wild will wind wish with without woman world would wrong yeah year yes yesterday you young your
`.trim().split(/\s+/))

// Words that say nothing about the song's language.
const NOISE = new Set('official audio video lyric lyrics lyrical hd hq full song version remix mix cover live feat ft prod mp3 wav flac m4a'.split(' '))

function isCommon(w: string): boolean {
  if (COMMON.has(w)) return true
  for (const end of ['ing', 'ed', 'es', 's', 'ly', 'in']) {
    if (w.length > end.length + 2 && w.endsWith(end)) {
      const stem = w.slice(0, -end.length)
      if (COMMON.has(stem) || COMMON.has(stem + 'e')) return true
    }
  }
  return false
}

export function titleLooksEnglish(fileName: string | undefined): boolean {
  const name = (fileName ?? '').replace(/\.[^.]+$/, '').toLowerCase()
  if (/[^\x00-\x7f]/.test(name)) return false // another script (e.g. Devanagari)
  const words = (name.match(/[a-z']+/g) ?? []).filter((w) => (!NOISE.has(w) && w.length > 1) || w === 'i' || w === 'a')
  if (!words.length) return false
  const hits = words.filter(isCommon).length
  return hits >= 1 && hits * 2 >= words.length
}
