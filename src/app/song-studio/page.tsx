import type { Metadata } from 'next'
import { SongStudioPage } from '@/components/song-studio/SongStudioPage'
import { songEngine } from '@/lib/song-engine'

export const metadata: Metadata = {
  title: 'MausamVox — Song Studio',
  description: 'Generate full AI songs from lyrics and a style prompt.',
}

// The engine is read from SONG_ENGINE on the server (it is not a NEXT_PUBLIC_
// var). This page and the /api/song-studio function are built in the same
// deploy, so they always agree — and changing SONG_ENGINE needs a redeploy
// for both anyway.
export default function Page() {
  return <SongStudioPage engine={songEngine()} />
}
