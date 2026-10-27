import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPage, LEGAL_OPERATOR, SUPPORT_EMAIL } from '@/components/legal/LegalPage'

export const metadata: Metadata = {
  title: 'MausamVox — Terms of Service',
  description: 'The terms that govern your use of MausamVox.',
}

// Draft (2026-10-27) — plain-language terms for the private beta and Paddle review; a lawyer
// reviews them before launch.
export default function Page() {
  return (
    <LegalPage title="Terms of Service" updated="27 October 2026">
      <h2>1. Who we are</h2>
      <p>
        MausamVox is run by {LEGAL_OPERATOR} (&ldquo;MausamLabs&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;).
        By creating an account or using MausamVox you agree to these terms.
      </p>

      <h2>2. What MausamVox does</h2>
      <p>
        MausamVox is an AI music tool. You can make a model of your own singing voice, swap the
        vocals of a song you upload into your voice, split songs into stems, and create songs,
        harmonies and instrument parts.
      </p>

      <h2>3. Who can use it</h2>
      <p>
        You must be 18 or older, or 13 or older with a parent or guardian&rsquo;s permission. You
        are responsible for your account and for keeping your password safe.
      </p>

      <h2>4. Your uploads — you must have the rights</h2>
      <p>
        Only upload audio you own or have the rights to use. When you upload, you confirm this.
        You keep ownership of what you upload. You give us permission to store and process it
        only to provide MausamVox to you.
      </p>
      <p>
        A swap of a song you don&rsquo;t own is for your personal, private use. Publishing or
        selling it may need permission from the song&rsquo;s rights holders — getting that is your
        responsibility.
      </p>

      <h2>5. Voice models — your own voice only</h2>
      <p>
        You may only make a voice model of <strong>your own voice</strong>. When you train a voice,
        you confirm it is your own voice and that you consent to it being modelled. We may check
        that a new recording matches the voice being trained.
      </p>
      <p>
        You must not use MausamVox to imitate or impersonate anyone else, to make anyone appear to
        say or sing something they didn&rsquo;t, or to deceive people about who is singing.
      </p>

      <h2>6. Acceptable use</h2>
      <p>You won&rsquo;t use MausamVox to:</p>
      <ul>
        <li>infringe copyright, trademarks or anyone else&rsquo;s rights;</li>
        <li>impersonate a person, or make deepfakes of a real person without their explicit consent;</li>
        <li>create content that is illegal, defamatory, hateful, sexual content involving minors, or that harasses anyone;</li>
        <li>break, overload, or get around the limits of the service (for example by creating many accounts for free credits).</li>
      </ul>
      <p>We may suspend accounts or remove content that breaks these rules.</p>

      <h2>7. Credits and payment</h2>
      <p>
        MausamVox runs on credits. Credits are sold as <strong>one-time packs</strong> — there is no
        subscription and nothing renews. New accounts get a one-time amount of free credits.
        Prices and what each action costs are shown on the <Link href="/#pricing">pricing page</Link> and
        in the app before you use credits. Purchased credits are valid for <strong>12 months from
        the date of purchase</strong>.
      </p>
      <p>
        Payments are processed by Paddle.com, our reseller and Merchant of Record, which also
        handles taxes and invoices. Paddle&rsquo;s buyer terms apply to your purchase.
      </p>

      <h2>8. Refunds</h2>
      <p>
        See our <Link href="/refund">Refund Policy</Link>.
      </p>

      <h2>9. AI results</h2>
      <p>
        AI output can be imperfect: a voice may not sound exactly like you, words can be less clear,
        and results vary between runs. You decide how you use your results and you are responsible
        for that use.
      </p>

      <h2>10. Takedown requests</h2>
      <p>
        If you believe content on MausamVox infringes your rights or uses your voice without your
        consent, email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with the details and a
        link to the content. We review every request and remove content that breaks these terms.
      </p>

      <h2>11. Ending your account</h2>
      <p>
        You can ask us to delete your account at any time by emailing{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. You can delete individual voices and
        saved swaps yourself in the app. We may suspend or close accounts that break these terms.
      </p>

      <h2>12. Liability</h2>
      <p>
        MausamVox is provided &ldquo;as is&rdquo;. To the extent the law allows, we aren&rsquo;t liable
        for indirect losses, and our total liability to you is limited to what you paid us in the 12
        months before the claim. Nothing in these terms limits rights you have by law as a consumer.
      </p>

      <h2>13. Changes</h2>
      <p>
        We may update these terms. We&rsquo;ll post the new date here, and tell you in the app about
        important changes.
      </p>

      <h2>14. Law</h2>
      <p>These terms are governed by the laws of India. The courts of Assam, India have jurisdiction.</p>

      <h2>15. Contact</h2>
      <p>
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> (support, refunds, takedowns) ·{' '}
        <a href="mailto:hello@mausamvox.com">hello@mausamvox.com</a> (general)
      </p>
    </LegalPage>
  )
}
