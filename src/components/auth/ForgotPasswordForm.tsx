'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { AuthCard } from './AuthCard'

export function ForgotPasswordForm() {
  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [sent, setSent]       = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/update-password`,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setSent(true)
  }

  if (sent) {
    return (
      <AuthCard>
        <div className="au-sent">
          <span className="au-sent-icon">📬</span>
          <div className="au-sent-title">Reset link sent</div>
          <div className="au-sent-sub">
            We emailed a reset link to{' '}
            <strong style={{ color: '#C4C4E0' }}>{email}</strong>.
            <br />Check your inbox and follow the instructions.
          </div>
          <div className="au-footer-link" style={{ marginTop: 28 }}>
            <Link href="/auth/sign-in" className="au-link">
              ← Back to sign in
            </Link>
          </div>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard>
      <div className="au-title">Reset your password</div>
      <div className="au-subtitle">
        Enter your email and we&apos;ll send a reset link.
      </div>

      {error && <div className="au-error">{error}</div>}

      <form onSubmit={handleSubmit} className="au-form">
        <div className="au-field">
          <label className="au-label">Email address</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="au-input"
            placeholder="you@example.com"
            required
            autoComplete="email"
          />
        </div>
        <button type="submit" className="au-btn" disabled={loading}>
          {loading ? 'Sending…' : 'Send reset link →'}
        </button>
      </form>

      <div className="au-footer-link">
        <Link href="/auth/sign-in" className="au-link">
          ← Back to sign in
        </Link>
      </div>
    </AuthCard>
  )
}
