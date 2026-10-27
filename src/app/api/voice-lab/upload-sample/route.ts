import { NextResponse } from 'next/server'

// Retired 2026-10-27. This old route saved a voice straight to 'ready' with no model and no
// "this is my own voice" consent; nothing in the app calls it any more. Voices are saved by
// /api/voice-lab/presign → storage PUT → /api/voice-lab/create-clone (which requires consent).
export async function POST() {
  return NextResponse.json(
    { error: 'This upload route was retired — please reload MausamVox and save your voice again.' },
    { status: 410 },
  )
}
