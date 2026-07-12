import type { Metadata } from 'next'
import { SongStudioPage } from '@/components/song-studio/SongStudioPage'

export const metadata: Metadata = {
  title: 'MausamVox — Song Studio',
  description: 'Generate full AI songs from lyrics and a style prompt.',
}

export default function Page() {
  return <SongStudioPage />
}
