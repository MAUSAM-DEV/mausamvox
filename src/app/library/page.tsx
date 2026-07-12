import type { Metadata } from 'next'
import { LibraryPage } from '@/components/library/LibraryPage'

export const metadata: Metadata = {
  title: 'MausamVox — Voice Library',
  description: 'Browse community-shared AI voices and use them in your own swaps — free.',
}

export default function Page() {
  return <LibraryPage />
}
