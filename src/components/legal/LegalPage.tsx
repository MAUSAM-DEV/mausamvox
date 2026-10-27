import Link from 'next/link'
import { LogoFull } from '@/components/ui/Logo'

// Shared shell for the static legal pages (/terms, /privacy, /refund): dark-theme
// header + narrow readable column + a draft notice + footer cross-linking them.
// Server component — no interactivity needed.
//
// Operator, as the founder asked (2026-10-27): the founder's name + trading name + town only — no GSTIN
// or street address on the site (the repo is public).
export const LEGAL_OPERATOR = 'Mausam Kemprai, sole proprietor, trading as MausamLabs, Haflong, Assam, India'
export const SUPPORT_EMAIL = 'support@mausamvox.com'
export function LegalPage({ title, updated, children }: {
  title: string
  updated: string
  children: React.ReactNode
}) {
  return (
    <div className="lg-shell">
      <header className="lg-head">
        {/* LogoFull is itself a link home — wrapping it in another <a> broke hydration. */}
        <LogoFull size={30} />
      </header>

      <main className="lg-main">
        <div className="lg-draft" role="note">Draft — lawyer review before launch</div>
        <h1 className="lg-h1">{title}</h1>
        <p className="lg-updated">Last updated: {updated}</p>
        {children}
      </main>

      <footer className="lg-foot">
        <span>© 2026 MausamVox by MausamLabs</span>
        <span className="lg-foot-links">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/refund">Refund</Link>
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          <Link href="/">Home</Link>
        </span>
      </footer>

      <style suppressHydrationWarning>{`
        body { background: #05050F; }
        .lg-shell {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          background: #05050F;
        }
        .lg-head {
          padding: 18px 40px;
          border-bottom: 1px solid #2E2E56;
        }
        .lg-main {
          flex: 1;
          width: 100%;
          max-width: 720px;
          margin: 0 auto;
          padding: 48px 24px 72px;
        }
        .lg-h1 {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 32px;
          font-weight: 700;
          letter-spacing: -0.8px;
          color: #F0F0FF;
          margin: 0 0 8px;
        }
        .lg-updated {
          font-size: 12px;
          color: #8E8EB4;
          margin: 0 0 36px;
        }
        .lg-main h2 {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 16px;
          font-weight: 700;
          color: #F0F0FF;
          margin: 28px 0 8px;
        }
        .lg-main p, .lg-main li {
          font-size: 14px;
          line-height: 1.75;
          color: #C4C4E0;
          margin: 0 0 12px;
        }
        .lg-main ul {
          margin: 0 0 12px;
          padding-left: 22px;
        }
        .lg-main li { margin-bottom: 4px; }
        .lg-main a { color: #9D5CFF; text-decoration: none; }
        .lg-main a:hover { text-decoration: underline; }
        .lg-draft {
          display: inline-block;
          margin: 0 0 18px;
          padding: 4px 12px;
          border-radius: 999px;
          border: 1px solid rgba(245,158,11,.5);
          background: rgba(245,158,11,.1);
          color: #FCD34D;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: .3px;
        }
        .lg-foot {
          border-top: 1px solid #2E2E56;
          padding: 20px 40px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 12px;
          font-size: 12px;
          color: #9494BC;
        }
        .lg-foot-links { display: flex; gap: 8px 20px; flex-wrap: wrap; }
        .lg-foot-links a { color: #9494BC; text-decoration: none; }
        .lg-foot-links a:hover { color: #F0F0FF; }
        @media (max-width: 640px) {
          .lg-head, .lg-foot { padding-left: 20px; padding-right: 20px; }
          .lg-main { padding-top: 32px; }
          .lg-h1 { font-size: 26px; }
        }
      `}</style>
    </div>
  )
}
