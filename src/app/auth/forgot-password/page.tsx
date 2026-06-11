import type { Metadata } from 'next'
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm'

export const metadata: Metadata = {
  title: 'Reset password — MausamVox',
  description: 'Reset your MausamVox account password.',
}

export default function Page() {
  return <ForgotPasswordForm />
}
