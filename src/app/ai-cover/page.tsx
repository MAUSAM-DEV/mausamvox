import type { Metadata } from 'next'
import { VoiceSwapPage } from '@/components/voice-swap/VoiceSwapPage'

export const metadata: Metadata = {
  title: 'MausamVox — AI Cover',
  description: 'Make an AI cover of any song with a free community voice — no setup, no voice training.',
}

// AI Cover is Voice Swap's guided mode: the exact same pipeline, steps and
// credit charges, framed as a zero-setup wizard around Library (community)
// voices for users who haven't trained a clone yet. No parallel pipeline.
export default function Page() {
  return <VoiceSwapPage guided />
}
