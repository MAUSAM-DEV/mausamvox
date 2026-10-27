import type { Metadata } from 'next'
import { LegalPage, LEGAL_OPERATOR, SUPPORT_EMAIL } from '@/components/legal/LegalPage'

export const metadata: Metadata = {
  title: 'MausamVox — Refund Policy',
  description: 'Refunds for MausamVox credit packs.',
}

// Draft (2026-10-27) — the founder's refund terms, in plain language; a lawyer reviews them
// before launch.
export default function Page() {
  return (
    <LegalPage title="Refund Policy" updated="27 October 2026">
      <p>
        MausamVox is run by {LEGAL_OPERATOR}. Credit packs are sold through Paddle.com, our
        Merchant of Record.
      </p>

      <h2>What you buy</h2>
      <p>
        One-time credit packs. There are <strong>no subscriptions</strong> and nothing to cancel.
        Purchased credits are valid for <strong>12 months from the date of purchase</strong>.
      </p>

      <h2>When you get a refund</h2>
      <ul>
        <li><strong>Unused pack:</strong> a full refund if you ask within <strong>14 days</strong> of purchase.</li>
        <li><strong>Technical failure on our side</strong> — you were charged but the credits weren&rsquo;t added, or a job failed on our side: we restore the credits or refund you.</li>
        <li><strong>Duplicate or accidental charge:</strong> a full refund.</li>
      </ul>

      <h2>When you don&rsquo;t</h2>
      <p>
        A pack that has been partly or fully used is not refundable: the digital service has been
        delivered.
      </p>

      <h2>How to ask</h2>
      <p>
        Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with your account email and your
        Paddle order number. You can also contact Paddle&rsquo;s buyer support at{' '}
        <a href="https://paddle.net" target="_blank" rel="noopener noreferrer">paddle.net</a>.
      </p>

      <h2>Your legal rights</h2>
      <p>
        If you are a consumer in the EU or the UK, you keep your statutory rights; nothing in this
        policy limits them.
      </p>
    </LegalPage>
  )
}
