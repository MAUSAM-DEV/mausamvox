import type { Metadata } from 'next'
import { SettingsPage } from '@/components/settings/SettingsPage'

export const metadata: Metadata = {
  title: 'MausamVox — Account Settings',
  description: 'Manage your MausamVox account.',
}

export default function Page() {
  return <SettingsPage />
}
