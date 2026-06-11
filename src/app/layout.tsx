import type { Metadata } from 'next'
import { Space_Grotesk, Inter } from 'next/font/google'
import './globals.css'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-grotesk',
  display: 'swap',
})

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'MausamVox — Any Voice. Any Language. Any Song.',
  description:
    'Clone your voice in minutes. Swap vocals in any song. Build cinematic choirs. Professional quality — honest controls.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${inter.variable}`}>
      <body
        className="bg-void text-white font-inter overflow-x-hidden leading-relaxed"
        style={{ background: '#05050F', color: '#F0F0FF', fontFamily: 'var(--font-inter), Inter, sans-serif' }}
      >
        {children}
      </body>
    </html>
  )
}
