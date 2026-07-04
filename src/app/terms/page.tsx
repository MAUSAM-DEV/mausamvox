import type { Metadata } from 'next'
import { LegalPage } from '@/components/legal/LegalPage'

export const metadata: Metadata = {
  title: 'MausamVox — Terms of Service',
  description: 'The terms that govern your use of MausamVox.',
}

export default function Page() {
  return (
    <LegalPage title="Terms of Service" updated="July 2026">
      <h2>1. Acceptance</h2>
      <p>By using MausamVox, you agree to these terms.</p>

      <h2>2. What we offer</h2>
      <p>An AI-powered platform for vocal swapping and voice cloning on songs.</p>

      <h2>3. Who can use it</h2>
      <p>
        You must be 18 or older, or 13+ with a parent/guardian&rsquo;s permission.
      </p>

      <h2>4. Voice cloning — important</h2>
      <p>
        You may only create a voice clone of your own voice, or a voice you have
        explicit permission to clone. Cloning or impersonating someone
        else&rsquo;s voice without their consent is strictly prohibited.
      </p>

      <h2>5. Acceptable use</h2>
      <p>
        You won&rsquo;t use MausamVox to create illegal, defamatory, or
        infringing content, to impersonate anyone without consent, or to harass
        others.
      </p>

      <h2>6. Your content</h2>
      <p>
        You keep ownership of what you upload. By uploading, you give MausamVox
        permission to process it solely to provide the service to you.
      </p>

      <h2>7. Credits &amp; billing</h2>
      <p>
        MausamVox currently operates on a credit system. Paid billing terms will
        be added here once payment features launch.
      </p>

      <h2>8. As-is service</h2>
      <p>
        MausamVox is provided &ldquo;as is.&rdquo; Features may change, and we
        don&rsquo;t guarantee uninterrupted service, especially during this early
        stage.
      </p>

      <h2>9. Termination</h2>
      <p>We may suspend or terminate accounts that violate these terms.</p>

      <h2>10. Governing law</h2>
      <p>These terms are governed by the laws of India.</p>

      <h2>Contact</h2>
      <p>
        <a href="mailto:hello@mausamvox.com">hello@mausamvox.com</a>
      </p>
    </LegalPage>
  )
}
