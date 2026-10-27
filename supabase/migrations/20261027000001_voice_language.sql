-- A voice's language, detected from its Voice Lab recording (2026-10-27, step 7 blocker 2).
--
-- Voice Lab has no language choice, so every voice was stored with the column default 'en'
-- ("Mausam Hindi", "Wife Hindi", …). HD Voice's reference pick then looked for clear ENGLISH
-- words in Hindi singing (step 6 test: a weak reference for Thinking Out Loud, a Whisper-loop
-- window for Sheila Ki Jawani). From now on the app detects the language from the recording
-- (/api/voice-lab/language → the finishing machine's voice_language task: Whisper-small over
-- every 30 s chunk, majority wins, Urdu counts as Hindi) and marks it with language_detected.
-- HD trusts voice_clones.language only when language_detected is true (otherwise Whisper
-- decides per window).
--
-- Apply in the Supabase SQL Editor. Safe to run before or after the deploy: until it exists
-- the app treats every voice as "not detected yet".

alter table public.voice_clones add column if not exists language_detected boolean not null default false;

-- ── one-time fix: every voice that has a recording (detected 2026-10-27 with the same vote,
--    run locally on the stored recordings; 12 voices, 2 accounts) ─────────────────────────
update public.voice_clones set language = 'hi', language_detected = true where id = '558972d8-c326-40ae-8633-28ea9dd69dea';  -- Raju (was en)
update public.voice_clones set language = 'hi', language_detected = true where id = '6ec163c9-0c1e-4845-b096-93e7c8133b22';  -- MK (was en)
update public.voice_clones set language = 'hi', language_detected = true where id = 'b79074c2-d9ef-4376-b137-95c6fc7bba0e';  -- MKIPHONE (was en)
update public.voice_clones set language = 'hi', language_detected = true where id = '12e16c4b-0615-4892-9751-ca4be76588ff';  -- Mausam (Singing) (was hi)
update public.voice_clones set language = 'hi', language_detected = true where id = 'be2075cf-1f2f-4177-b89e-9f1ba2b72126';  -- Mausam (Lossless) (was hi)
update public.voice_clones set language = 'hi', language_detected = true where id = 'fbb2b743-9a8b-455b-8cc9-25bb18337724';  -- Mausam (All) (was hi)
update public.voice_clones set language = 'hi', language_detected = true where id = '5a93fd0f-e8f4-4b16-8d49-1d373881f485';  -- Wife (Hindi) (was en)
update public.voice_clones set language = 'en', language_detected = true where id = '2e963514-0a5b-4f65-a9c7-66cfd33153fa';  -- Wife (English) (was en)
update public.voice_clones set language = 'hi', language_detected = true where id = 'c57290ad-af36-4203-ae7d-d6e8343a28e1';  -- Wife (All) (was hi)
update public.voice_clones set language = 'en', language_detected = true where id = 'ed916a39-e046-4b72-a304-4904db6af26f';  -- Mausam English (was en)
update public.voice_clones set language = 'hi', language_detected = true where id = 'b95b631e-bd03-4ec2-862d-ab65b2c11b52';  -- Mausam Hindi (was en)
update public.voice_clones set language = 'hi', language_detected = true where id = '272925fe-5b5d-483c-bff0-eb51b582d2cf';  -- Wife Hindi (was en)
