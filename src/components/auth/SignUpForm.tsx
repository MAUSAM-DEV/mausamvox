'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { AuthCard } from './AuthCard'

export function SignUpForm() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [sent, setSent]         = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
      },
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
          <div className="au-sent-title">Check your inbox</div>
          <div className="au-sent-sub">
            We sent a confirmation link to{' '}
            <strong style={{ color: '#C4C4E0' }}>{email}</strong>.
            <br />Click it to activate your account.
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
      <div className="au-title">Create your account</div>
      <div className="au-subtitle">Your first voice swap is on us.</div>

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
        <div className="au-field">
          <label className="au-label">Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="au-input"
            placeholder="8+ characters"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        <button type="submit" className="au-btn" disabled={loading}>
          {loading ? 'Creating account…' : 'Create account →'}
        </button>
      </form>

      <div className="au-footer-link">
        Already have an account?{' '}
        <Link href="/auth/sign-in" className="au-link">
          Sign in →
        </Link>
      </div>
    </AuthCard>
  )
}
