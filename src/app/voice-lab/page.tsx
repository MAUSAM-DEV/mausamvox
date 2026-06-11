import type { Metadata } from 'next'
import { VoiceLabPage } from '@/components/voice-lab/VoiceLabPage'

export const metadata: Metadata = {
  title: 'MausamVox — Voice Lab',
  description: 'Train your personal AI singing voice clone with MausamVox Voice Lab.',
}

export default function Page() {
  return <VoiceLabPage />
}
