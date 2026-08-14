import type { Metadata } from 'next'
import { SignUpForm } from '@/components/auth/SignUpForm'
import { WaitlistForm } from '@/components/auth/WaitlistForm'
import { SIGNUPS_OPEN } from '@/lib/signups'

export const metadata: Metadata = SIGNUPS_OPEN
  ? {
      title: 'Create account — MausamVox',
      description: 'Start your free MausamVox account.',
    }
  : {
      title: 'Launching soon — MausamVox',
      description: 'Sign-ups are closed for now. Join the waitlist and we will email you the day MausamVox opens.',
    }

export default function Page() {
  return SIGNUPS_OPEN ? <SignUpForm /> : <WaitlistForm />
}
