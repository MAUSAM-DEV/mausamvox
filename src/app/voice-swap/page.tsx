import type { Metadata } from 'next'
import { VoiceSwapPage } from '@/components/voice-swap/VoiceSwapPage'

export const metadata: Metadata = {
  title: 'MausamVox — Voice Swap',
  description: 'Replace any song\'s vocals with your cloned AI voice.',
}

export default function Page() {
  return <VoiceSwapPage />
}
