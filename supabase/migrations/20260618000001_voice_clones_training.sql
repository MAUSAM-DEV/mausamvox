-- Phase B: training column on voice_clones
--
-- training_prediction_id: the Replicate prediction id for an in-flight
--   train-rvc-model run. /api/voice-lab/train (POST) sets it and flips
--   status to 'training'; the GET reconcile route reads it to poll Replicate
--   and, on success, writes the trained model URL to model_url + status 'ready'.
--
-- Reuses existing columns: status (pending|training|ready|failed), model_url
-- (the trained RVC zip URL consumed by /api/voice-convert), and dataset_zip_url
-- (added in Phase A).

alter table public.voice_clones
  add column if not exists training_prediction_id text;
