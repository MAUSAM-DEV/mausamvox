import type { Metadata } from 'next'
import { SignUpForm } from '@/components/auth/SignUpForm'

export const metadata: Metadata = {
  title: 'Create account — MausamVox',
  description: 'Start your free MausamVox account.',
}

export default function Page() {
  return <SignUpForm />
}
