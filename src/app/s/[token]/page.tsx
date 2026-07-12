import type { Metadata } from 'next'
import { SharedTrackPage } from '@/components/share/SharedTrackPage'

export const metadata: Metadata = {
  title: 'MausamVox — Shared Track',
  description: 'Listen to a track made with MausamVox AI voice swap.',
}

// Public page — deliberately NOT in the middleware auth matcher. Anyone with
// the link can listen; no account required.
export default function Page({ params }: { params: { token: string } }) {
  return <SharedTrackPage token={params.token} />
}
