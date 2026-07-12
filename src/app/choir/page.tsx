import type { Metadata } from 'next'
import { ChoirPage } from '@/components/choir/ChoirPage'

export const metadata: Metadata = {
  title: 'MausamVox — Choir Composer',
  description: 'Turn a solo vocal into stacked harmonies.',
}

export default function Page() {
  return <ChoirPage />
}
