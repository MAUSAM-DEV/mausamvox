import Link from 'next/link'
import { LogoFull } from '@/components/ui/Logo'

// Shared shell for the static legal pages (/privacy, /terms): dark-theme
// header + narrow readable column + minimal footer cross-linking the two.
// Server component — no interactivity needed.
export function LegalPage({ title, updated, children }: {
  title: string
  updated: string
  children: React.ReactNode
}) {
  return (
    <div className="lg-shell">
      <header className="lg-head">
        <Link href="/" style={{ textDecoration: 'none' }}>
          <LogoFull size={30} />
        </Link>
      </header>

      <main className="lg-main">
        <h1 className="lg-h1">{title}</h1>
        <p className="lg-updated">Last updated: {updated}</p>
        {children}
      </main>

      <footer className="lg-foot">
        <span>© 2026 MausamVox</span>
        <span className="lg-foot-links">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/">Home</Link>
        </span>
      </footer>

      <style>{`
        body { background: #05050F; }
        .lg-shell {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          background: #05050F;
        }
        .lg-head {
          padding: 18px 40px;
          border-bottom: 1px solid #1E1E3A;
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
          color: #5A5A80;
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
        .lg-main a { color: #8B5CF6; text-decoration: none; }
        .lg-main a:hover { text-decoration: underline; }
        .lg-foot {
          border-top: 1px solid #1E1E3A;
          padding: 20px 40px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 12px;
          font-size: 12px;
          color: #606088;
        }
        .lg-foot-links { display: flex; gap: 20px; }
        .lg-foot-links a { color: #606088; text-decoration: none; }
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
