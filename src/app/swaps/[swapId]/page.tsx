import type { Metadata } from 'next'
import { SavedSwapPage } from '@/components/swaps/SavedSwapPage'

export const metadata: Metadata = {
  title: 'MausamVox — Saved Swap',
  description: 'Play back and download a saved voice swap.',
}

export default function Page({ params }: { params: { swapId: string } }) {
  return <SavedSwapPage swapId={params.swapId} />
}
