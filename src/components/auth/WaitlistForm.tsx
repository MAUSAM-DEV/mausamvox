'use client'

import { useState } from 'react'
import Link from 'next/link'
import isEmail from 'validator/lib/isEmail'
import { AuthCard } from './AuthCard'

/**
 * Shown in place of SignUpForm while NEXT_PUBLIC_SIGNUPS_OPEN !== "true".
 * Existing accounts sign in normally — only new registration is paused.
 */
export function WaitlistForm() {
  const [email, setEmail]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')
  const [joined, setJoined] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!isEmail(email.trim())) {
      setError('Please enter a valid email address.')
      return
    }

    setLoading(true)

    let res: Response
    try {
      res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
    } catch {
      setError('Network error. Please check your connection and try again.')
      setLoading(false)
      return
    }

    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      setError(data.error ?? 'Something went wrong. Please try again.')
      setLoading(false)
      return
    }

    setJoined(true)
  }

  if (joined) {
    return (
      <AuthCard>
        <div className="au-sent">
          <span className="au-sent-icon">🎉</span>
          <div className="au-sent-title">You&apos;re on the list!</div>
          <div className="au-sent-sub">
            We&apos;ll email{' '}
            <strong style={{ color: '#C4C4E0' }}>{email.trim().toLowerCase()}</strong>{' '}
            the moment MausamVox opens up.
            <br />No spam, no newsletter — just the launch.
          </div>
          <div className="au-footer-link" style={{ marginTop: 28 }}>
            <Link href="/" className="au-link">
              ← Back to home
            </Link>
          </div>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard>
      <div className="wl-badge">🚀 Launching soon — sign-ups are closed for now</div>

      <div className="au-title">Be the first to know</div>
      <div className="au-subtitle">
        We&apos;re putting the final polish on MausamVox. Drop your email and
        we&apos;ll tell you the day it opens.
      </div>

      {error && <div className="au-error">{error}</div>}

      <form onSubmit={handleSubmit} className="au-form">
        <div className="au-field">
          <label className="au-label" htmlFor="wl-email">Email address</label>
          <input
            id="wl-email"
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
          {loading ? 'Adding you…' : 'Join the waitlist →'}
        </button>
      </form>

      <div className="au-footer-link">
        Already have an account?{' '}
        <Link href="/auth/sign-in" className="au-link">
          Sign in →
        </Link>
      </div>

      <style>{`
        .wl-badge {
          display: block;
          text-align: center;
          font-family: var(--font-inter), 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 500;
          line-height: 1.5;
          color: #C4C4E0;
          background: rgba(157,92,255,.09);
          border: 1px solid rgba(157,92,255,.28);
          border-radius: 999px;
          padding: 8px 14px;
          margin-bottom: 22px;
        }
        @media (max-width: 480px) {
          .wl-badge { border-radius: 12px; }
        }
      `}</style>
    </AuthCard>
  )
}
