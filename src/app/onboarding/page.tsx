import type { Metadata } from 'next'
import { OnboardingPage } from '@/components/onboarding/OnboardingPage'

export const metadata: Metadata = {
  title: 'Welcome to MausamVox',
  description: 'Set up your MausamVox experience in under 3 minutes.',
}

export default function Page() {
  return <OnboardingPage />
}
