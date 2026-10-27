import type { Metadata } from 'next'
import { LegalPage, LEGAL_OPERATOR, SUPPORT_EMAIL } from '@/components/legal/LegalPage'

export const metadata: Metadata = {
  title: 'MausamVox — Privacy Policy',
  description: 'How MausamVox collects, uses, and protects your data.',
}

// Draft (2026-10-27) — lists the processors the app actually calls today; a lawyer reviews it
// before launch.
export default function Page() {
  return (
    <LegalPage title="Privacy Policy" updated="27 October 2026">
      <h2>Who we are</h2>
      <p>
        MausamVox is run by {LEGAL_OPERATOR}. We are responsible for the personal data described
        here.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account:</strong> your email address and sign-in details.</li>
        <li><strong>Voice recordings</strong> you make or upload to create a voice model, and the voice model made from them.</li>
        <li><strong>Songs and audio</strong> you upload, the stems we split from them, and the results you create.</li>
        <li><strong>Usage:</strong> your credit balance, what you spent credits on, and basic logs needed to run and secure the service.</li>
        <li><strong>Purchases:</strong> handled by Paddle. We receive the order details (what you bought, when) but never your card details.</li>
      </ul>

      <h2>How we use it</h2>
      <p>
        Only to provide MausamVox to you: making your voice model, swapping and splitting your
        songs, keeping your credit balance, preventing abuse (for example, checking a new
        recording matches the voice being trained), and contacting you about your account. We
        don&rsquo;t sell your data and we don&rsquo;t use your voice or songs for advertising.
      </p>

      <h2>Who processes it for us</h2>
      <p>These providers receive only what they need to do their job:</p>
      <ul>
        <li><strong>Supabase</strong> — database, sign-in and file storage.</li>
        <li><strong>Vercel</strong> — hosting of the website and app.</li>
        <li><strong>Replicate</strong> — runs the AI models that separate, convert and create audio (including Google&rsquo;s Lyria music model and OpenAI&rsquo;s gpt-4o-mini for lyrics, both run through Replicate).</li>
        <li><strong>MVSEP</strong> — studio-quality vocal separation of uploaded songs.</li>
        <li><strong>Paddle</strong> — payments, taxes and invoices, as Merchant of Record.</li>
      </ul>
      <p>Some of these providers process data outside India, for example in the USA or the EU.</p>

      <h2>How long we keep it</h2>
      <p>
        We keep your data while your account is open. You can delete a voice (its recordings and
        model) in My Voices, and a saved swap in your library, at any time. To delete your whole
        account and everything in it, email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> from your account&rsquo;s email.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask to see, correct, export or delete your data, or object to how we use it, by
        emailing <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. If you are in the EU or the
        UK you can also complain to your local data-protection authority.
      </p>

      <h2>Security</h2>
      <p>
        Your files are stored privately and are reached through short-lived links, or through a
        share link if you choose to create one. No online service can guarantee complete security.
      </p>

      <h2>Children</h2>
      <p>MausamVox is not for children under 13.</p>

      <h2>Changes</h2>
      <p>We may update this policy; we&rsquo;ll post the new date here when we do.</p>

      <h2>Contact</h2>
      <p>
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> (privacy, support) ·{' '}
        <a href="mailto:hello@mausamvox.com">hello@mausamvox.com</a> (general)
      </p>
    </LegalPage>
  )
}
