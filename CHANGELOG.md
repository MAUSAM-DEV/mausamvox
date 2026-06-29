# Changelog

One dated line per completed step/session. Newest first. Each entry ends with the commit hash.

## 2026-06-30

- Fix stale dashboard counts — Voice Swaps + Voice Clones counts now refetch on window focus and tab visibilitychange (were fetched once on mount); delete handler refetches authoritatively instead of optimistic local −1. (commit: 3bb8d75)
- Restore duet-split warning before auto-split — declared-duet uploads no longer silently run the 250cr gender-split; the existing amber gate renders and the user must click "Split duet · 250 cr · Premium" to proceed (Option A: handleStemDone no longer auto-calls runGenderSplit / sets genderSplitting). (commit: d273e69)

## 2026-06-29

- Add start-point picker to Fine-tune preview — choose which 12s window of the song to preview (skip music-only intros); trimAudioToClip gains startSeconds, clip cache key includes start+length, control bounded by song duration. (commit: eeb0fa1)
- Shorten Fine-tune preview clip from 30s to 12s (PREVIEW_CLIP_SECONDS=12 + all "30 sec" UI text/labels updated); faster + cheaper tuning previews. (commit: 8f37e83)
- Add "Reset to defaults" button to the Fine-tune Advanced panel — restores all tuner sliders (Voice strength/index_rate, protect, filter_radius, rms_mix_rate) to defaults in one click. (commit: 213aa49)
- Add "Known gotchas (reference, do not re-debug)" section to PROJECT_STATUS.md (MVSEP label reliability, Replicate filename/proxy fix, lamejs fork, undici allowH2:false, Node 26 HTTP/2, Supabase Pro for 116MB+ models). (commit: 40c4de2)
- Add handoff files: PROJECT_STATUS.md, CHANGELOG.md, CLAUDE.md (working rules + gotchas + session handoff protocol), AGENTS.md. (commit: 4da1ebc)
