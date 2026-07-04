import type { Metadata } from 'next'
import { SwapsIndexPage } from '@/components/swaps/SwapsIndexPage'

export const metadata: Metadata = {
  title: 'MausamVox — Saved Tracks',
  description: 'All your saved voice swaps in one place.',
}

export default function Page() {
  return <SwapsIndexPage />
}
