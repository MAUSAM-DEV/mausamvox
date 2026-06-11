import type { Metadata } from 'next'
import { UpdatePasswordForm } from '@/components/auth/UpdatePasswordForm'

export const metadata: Metadata = {
  title: 'Update password — MausamVox',
  description: 'Set a new password for your MausamVox account.',
}

export default function Page() {
  return <UpdatePasswordForm />
}
