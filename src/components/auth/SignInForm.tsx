'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import isEmail from 'validator/lib/isEmail'
import { AuthCard } from './AuthCard'

function SignInInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect') ?? '/voice-swap'

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    // ── Client-side validation (before any network call) ──────────
    if (!isEmail(email)) {
      setError('Please enter a valid email address.')
      return
    }

    setLoading(true)

    const res = await fetch('/api/auth/sign-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Sign-in failed. Please try again.')
      setLoading(false)
      return
    }

    router.push(redirect)
    router.refresh()
  }

  return (
    <AuthCard>
      <div className="au-title">Welcome back</div>
      <div className="au-subtitle">Sign in to continue creating.</div>

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
          <div className="au-label-row">
            <label className="au-label">Password</label>
            <Link href="/auth/forgot-password" className="au-link-sm">
              Forgot password?
            </Link>
          </div>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="au-input"
            placeholder="••••••••"
            required
            autoComplete="current-password"
          />
        </div>
        <button type="submit" className="au-btn" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in →'}
        </button>
      </form>

      <div className="au-footer-link">
        Don&apos;t have an account?{' '}
        <Link href="/auth/sign-up" className="au-link">
          Sign up →
        </Link>
      </div>
    </AuthCard>
  )
}

export function SignInForm() {
  return (
    <Suspense>
      <SignInInner />
    </Suspense>
  )
}
