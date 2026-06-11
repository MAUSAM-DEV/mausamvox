import { LogoFull } from '@/components/ui/Logo'
import type { ReactNode } from 'react'

export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="au-card">
      <div className="au-logo-row">
        <LogoFull size={30} />
      </div>
      {children}
    </div>
  )
}
