'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { AuthCard } from './AuthCard'
import { PasswordInput } from './PasswordInput'

export function UpdatePasswordForm() {
  const router = useRouter()

  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setError("Passwords don't match.")
      return
    }
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push('/')
    router.refresh()
  }

  return (
    <AuthCard>
      <div className="au-title">Set new password</div>
      <div className="au-subtitle">Choose a strong password for your account.</div>

      {error && <div className="au-error">{error}</div>}

      <form onSubmit={handleSubmit} className="au-form">
        <div className="au-field">
          <label className="au-label">New password</label>
          <PasswordInput
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="8+ characters"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        <div className="au-field">
          <label className="au-label">Confirm password</label>
          <PasswordInput
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            required
            autoComplete="new-password"
          />
        </div>
        <button type="submit" className="au-btn" disabled={loading}>
          {loading ? 'Updating…' : 'Update password →'}
        </button>
      </form>
    </AuthCard>
  )
}
