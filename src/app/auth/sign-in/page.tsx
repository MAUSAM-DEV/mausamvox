import type { Metadata } from 'next'
import { SignInForm } from '@/components/auth/SignInForm'

export const metadata: Metadata = {
  title: 'Sign in — MausamVox',
  description: 'Sign in to your MausamVox account.',
}

export default function Page() {
  return <SignInForm />
}
