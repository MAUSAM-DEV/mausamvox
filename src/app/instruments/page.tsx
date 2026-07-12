import type { Metadata } from 'next'
import { InstrumentsPage } from '@/components/instruments/InstrumentsPage'

export const metadata: Metadata = {
  title: 'MausamVox — Instruments',
  description: 'Hum a melody and hear it played on a real instrument.',
}

export default function Page() {
  return <InstrumentsPage />
}
