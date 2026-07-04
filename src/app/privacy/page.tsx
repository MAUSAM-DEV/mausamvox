import type { Metadata } from 'next'
import { LegalPage } from '@/components/legal/LegalPage'

export const metadata: Metadata = {
  title: 'MausamVox — Privacy Policy',
  description: 'How MausamVox collects, uses, and protects your data.',
}

export default function Page() {
  return (
    <LegalPage title="Privacy Policy" updated="July 2026">
      <h2>Who we are</h2>
      <p>MausamVox is an AI vocal-swap and voice-cloning platform.</p>

      <h2>What we collect</h2>
      <ul>
        <li>Your account email</li>
        <li>Voice recordings you provide to create a voice clone</li>
        <li>Songs/audio files you upload</li>
        <li>Usage data (credits, swap history)</li>
      </ul>

      <h2>How we use it</h2>
      <p>
        To provide the core service (creating voice clones, swapping vocals in
        songs), to improve the app, and to contact you about your account.
      </p>

      <h2>Who else sees your data</h2>
      <p>
        We use trusted service providers to run MausamVox — a database/hosting
        provider, and AI processing services that perform the voice separation
        and conversion. They only receive what&rsquo;s needed to do their specific
        job, and don&rsquo;t use your data for anything else.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Audio files are automatically cleaned up after a set period. You can
        delete your voice clones and recordings at any time from &ldquo;My
        Voices.&rdquo;
      </p>

      <h2>Your rights</h2>
      <p>
        You can request access to or deletion of your data at any time by
        contacting us.
      </p>

      <h2>Security</h2>
      <p>
        We take reasonable steps to protect your data, but no online service can
        guarantee complete security.
      </p>

      <h2>Children</h2>
      <p>MausamVox is not intended for users under 13.</p>

      <h2>Changes</h2>
      <p>
        We may update this policy; we&rsquo;ll post the new date here when we do.
      </p>

      <h2>Contact</h2>
      <p>
        <a href="mailto:hello@mausamvox.com">hello@mausamvox.com</a>
      </p>
    </LegalPage>
  )
}
