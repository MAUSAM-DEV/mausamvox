# Changelog

One dated line per completed step/session. Newest first. Each entry ends with the commit hash.

## 2026-06-29

- Shorten Fine-tune preview clip from 30s to 12s (PREVIEW_CLIP_SECONDS=12 + all "30 sec" UI text/labels updated); faster + cheaper tuning previews. (commit: 8f37e83)
- Add "Reset to defaults" button to the Fine-tune Advanced panel — restores all tuner sliders (Voice strength/index_rate, protect, filter_radius, rms_mix_rate) to defaults in one click. (commit: 213aa49)
- Add "Known gotchas (reference, do not re-debug)" section to PROJECT_STATUS.md (MVSEP label reliability, Replicate filename/proxy fix, lamejs fork, undici allowH2:false, Node 26 HTTP/2, Supabase Pro for 116MB+ models). (commit: 40c4de2)
- Add handoff files: PROJECT_STATUS.md, CHANGELOG.md, CLAUDE.md (working rules + gotchas + session handoff protocol), AGENTS.md. (commit: 4da1ebc)
