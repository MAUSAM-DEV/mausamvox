import { LogoFull } from '@/components/ui/Logo'
import type { ReactNode } from 'react'

export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="au-card" style={{ position: 'relative' }}>
      <a href="/" className="au-close" aria-label="Back to home">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
        </svg>
      </a>

      <div className="au-logo-row">
        <LogoFull size={30} />
      </div>
      {children}

      <style>{`
        .au-close {
          position: absolute;
          top: 16px;
          right: 16px;
          width: 30px;
          height: 30px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #3A3A60;
          text-decoration: none;
          transition: color 0.2s, background 0.2s;
        }
        .au-close:hover {
          color: #C4C4E0;
          background: rgba(255,255,255,0.06);
        }
      `}</style>
    </div>
  )
}
