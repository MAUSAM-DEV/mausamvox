-- Create buckets if they don't already exist.
-- audio-uploads: full tracks and extracted stems from the voice-swap UI.
-- voice-samples: raw recordings and uploads from Voice Lab (API uploads via service role).

insert into storage.buckets (id, name, public)
values ('audio-uploads', 'audio-uploads', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('voice-samples', 'voice-samples', false)
on conflict (id) do nothing;

-- ── audio-uploads RLS ─────────────────────────────────────────────────────
-- Paths: {userId}/{timestamp}-{filename}  — enforce per-user isolation.

drop policy if exists "audio_uploads: insert own" on storage.objects;
create policy "audio_uploads: insert own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'audio-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "audio_uploads: select own" on storage.objects;
create policy "audio_uploads: select own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'audio-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "audio_uploads: delete own" on storage.objects;
create policy "audio_uploads: delete own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'audio-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── voice-samples RLS ─────────────────────────────────────────────────────
-- Uploads go through /api/voice-lab/upload-sample (service role), but users
-- still need select/delete for their own files. Insert policy included so
-- direct browser uploads work if the flow ever changes.

drop policy if exists "voice_samples: insert own" on storage.objects;
create policy "voice_samples: insert own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'voice-samples'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "voice_samples: select own" on storage.objects;
create policy "voice_samples: select own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'voice-samples'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "voice_samples: delete own" on storage.objects;
create policy "voice_samples: delete own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'voice-samples'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
