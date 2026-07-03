import type { Metadata } from 'next'
import { StemStudioPage } from '@/components/stem-studio/StemStudioPage'

export const metadata: Metadata = {
  title: 'MausamVox — Stem Studio',
  description: 'Split any track into vocals, bass, drums and other stems.',
}

export default function Page() {
  return <StemStudioPage />
}
