'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { LogoFull } from '@/components/ui/Logo'
import { PasswordInput } from '@/components/auth/PasswordInput'

// Account Settings — only controls with a real backend today:
//   * Display name → public.users.full_name (RLS update-own + authenticated
//     UPDATE grant exist since 20260619000000) AND auth user_metadata.full_name
//     (the dashboard/nav read the name from metadata, so both must move).
//   * Email change → supabase.auth.updateUser({ email }); Supabase emails
//     confirmation link(s) that land on the existing /auth/callback route.
//     The change applies only after confirmation — the UI says so.
//   * Password → the same signed-in auth.updateUser({ password }) call the
//     /auth/update-password flow uses.
//   * Plan / credits / member-since → read-only from the users row.
//   * Danger zone: Sign Out. Account deletion is deliberately ABSENT — there
//     is no safe deletion flow yet (no storage cleanup or admin-delete route),
//     and per the honesty rules we don't ship dead controls.

type SectionMsg = { kind: 'ok' | 'err'; text: string } | null

export function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)

  // Profile
  const [fullName, setFullName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameMsg, setNameMsg] = useState<SectionMsg>(null)

  // Email
  const [email, setEmail] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)
  const [emailMsg, setEmailMsg] = useState<SectionMsg>(null)

  // Password
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [savingPw, setSavingPw] = useState(false)
  const [pwMsg, setPwMsg] = useState<SectionMsg>(null)

  // Read-only account info
  const [plan, setPlan] = useState<string | null>(null)
  const [credits, setCredits] = useState<number | null>(null)
  const [memberSince, setMemberSince] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user
      if (!u) return // middleware guarantees a session; belt-and-braces
      setUserId(u.id)
      setEmail(u.email ?? '')
      const metaName = (u.user_metadata?.full_name ?? u.user_metadata?.name ?? '') as string
      supabase
        .from('users')
        .select('full_name, plan, credits_remaining, created_at')
        .eq('id', u.id)
        .single()
        .then(({ data: row, error }) => {
          if (error) console.error('settings profile fetch failed', error)
          setFullName((row?.full_name ?? metaName ?? '').trim())
          if (row) {
            setPlan(row.plan)
            setCredits(row.credits_remaining)
            setMemberSince(row.created_at)
          }
          setLoading(false)
        })
    })
  }, [])

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault()
    const name = fullName.trim().slice(0, 80)
    if (!name) {
      setNameMsg({ kind: 'err', text: 'Display name can’t be empty.' })
      return
    }
    if (!userId) return
    setSavingName(true)
    setNameMsg(null)
    const supabase = createClient()
    // The users row is what the DB knows; user_metadata is what the header,
    // nav and onboarding actually display — update both.
    const { error: rowError } = await supabase
      .from('users')
      .update({ full_name: name })
      .eq('id', userId)
    const { error: metaError } = await supabase.auth.updateUser({ data: { full_name: name } })
    setSavingName(false)
    if (rowError || metaError) {
      setNameMsg({ kind: 'err', text: (rowError ?? metaError)!.message })
      return
    }
    setFullName(name)
    setNameMsg({ kind: 'ok', text: 'Name updated. Other pages pick it up on their next load.' })
  }

  async function handleChangeEmail(e: React.FormEvent) {
    e.preventDefault()
    const next = newEmail.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
      setEmailMsg({ kind: 'err', text: 'Enter a valid email address.' })
      return
    }
    if (next === email.toLowerCase()) {
      setEmailMsg({ kind: 'err', text: 'That’s already your email.' })
      return
    }
    setSavingEmail(true)
    setEmailMsg(null)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser(
      { email: next },
      { emailRedirectTo: `${window.location.origin}/auth/callback?next=/settings` }
    )
    setSavingEmail(false)
    if (error) {
      setEmailMsg({ kind: 'err', text: error.message })
      return
    }
    setNewEmail('')
    setEmailMsg({
      kind: 'ok',
      text: 'Confirmation sent — check the inbox of your new address (and the current one). The change applies only after you confirm.',
    })
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) {
      setPwMsg({ kind: 'err', text: 'Password must be at least 8 characters.' })
      return
    }
    if (password !== confirm) {
      setPwMsg({ kind: 'err', text: 'Passwords don’t match.' })
      return
    }
    setSavingPw(true)
    setPwMsg(null)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    setSavingPw(false)
    if (error) {
      setPwMsg({ kind: 'err', text: error.message })
      return
    }
    setPassword('')
    setConfirm('')
    setPwMsg({ kind: 'ok', text: 'Password updated.' })
  }

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  const planLabel = plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : '…'

  return (
    <>
      <div className="set-shell">
        <header className="set-head">
          <Link href="/" style={{ textDecoration: 'none' }}>
            <LogoFull size={30} />
          </Link>
          <Link href="/dashboard" className="set-back">← Dashboard</Link>
        </header>

        <main className="set-main">
          <h1 className="set-title">Account Settings</h1>
          <p className="set-sub">Your profile, sign-in details and plan.</p>

          {loading && <div className="set-note">Loading…</div>}

          {!loading && (
            <>
              {/* ── Profile ─────────────────────────────────────────────── */}
              <section className="set-card">
                <div className="set-card-title">Profile</div>
                <form onSubmit={handleSaveName} className="set-form">
                  <label className="set-label" htmlFor="set-name">Display name</label>
                  <div className="set-row">
                    <input
                      id="set-name"
                      className="set-input"
                      value={fullName}
                      onChange={(e) => { setFullName(e.target.value); setNameMsg(null) }}
                      maxLength={80}
                      placeholder="Your name"
                    />
                    <button type="submit" className="set-btn" disabled={savingName}>
                      {savingName ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                  {nameMsg && <div className={nameMsg.kind === 'ok' ? 'set-ok' : 'set-err'}>{nameMsg.text}</div>}
                </form>
              </section>

              {/* ── Email ───────────────────────────────────────────────── */}
              <section className="set-card">
                <div className="set-card-title">Email</div>
                <div className="set-current">Current: <span className="set-current-val">{email}</span></div>
                <form onSubmit={handleChangeEmail} className="set-form">
                  <label className="set-label" htmlFor="set-email">New email</label>
                  <div className="set-row">
                    <input
                      id="set-email"
                      className="set-input"
                      type="email"
                      value={newEmail}
                      onChange={(e) => { setNewEmail(e.target.value); setEmailMsg(null) }}
                      placeholder="you@example.com"
                    />
                    <button type="submit" className="set-btn" disabled={savingEmail || !newEmail.trim()}>
                      {savingEmail ? 'Sending…' : 'Change'}
                    </button>
                  </div>
                  {emailMsg && <div className={emailMsg.kind === 'ok' ? 'set-ok' : 'set-err'}>{emailMsg.text}</div>}
                </form>
              </section>

              {/* ── Password ────────────────────────────────────────────── */}
              <section className="set-card">
                <div className="set-card-title">Password</div>
                <form onSubmit={handleChangePassword} className="set-form">
                  <label className="set-label">New password</label>
                  <PasswordInput
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setPwMsg(null) }}
                    placeholder="8+ characters"
                    minLength={8}
                    autoComplete="new-password"
                  />
                  <label className="set-label" style={{ marginTop: 12 }}>Confirm new password</label>
                  <PasswordInput
                    value={confirm}
                    onChange={(e) => { setConfirm(e.target.value); setPwMsg(null) }}
                    autoComplete="new-password"
                  />
                  <div style={{ marginTop: 14 }}>
                    <button type="submit" className="set-btn" disabled={savingPw || !password}>
                      {savingPw ? 'Updating…' : 'Update password'}
                    </button>
                  </div>
                  {pwMsg && <div className={pwMsg.kind === 'ok' ? 'set-ok' : 'set-err'}>{pwMsg.text}</div>}
                </form>
              </section>

              {/* ── Account (read-only) ─────────────────────────────────── */}
              <section className="set-card">
                <div className="set-card-title">Account</div>
                <div className="set-info-row"><span>Plan</span><span className="set-info-val">{planLabel}</span></div>
                <div className="set-info-row"><span>Credits remaining</span><span className="set-info-val">{credits === null ? '…' : credits.toLocaleString('en-US')}</span></div>
                <div className="set-info-row"><span>Member since</span><span className="set-info-val">{memberSince ? new Date(memberSince).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '…'}</span></div>
              </section>

              {/* ── Danger zone ─────────────────────────────────────────── */}
              <section className="set-card set-danger">
                <div className="set-card-title">Danger zone</div>
                <div className="set-row" style={{ alignItems: 'center' }}>
                  <div className="set-danger-txt">Sign out of MausamVox on this device.</div>
                  <button className="set-btn set-btn-danger" onClick={handleSignOut}>Sign Out</button>
                </div>
                <div className="set-danger-note">
                  Account deletion isn’t self-serve yet — it’s coming once we can wipe your
                  audio and voice models safely in one step.
                </div>
              </section>
            </>
          )}
        </main>
      </div>

      <style suppressHydrationWarning>{`
        body { background: #05050F; }
        .set-shell {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          background: #05050F;
        }
        .set-head {
          padding: 18px 40px;
          border-bottom: 1px solid #1E1E3A;
          display: flex; align-items: center; justify-content: space-between;
        }
        .set-back {
          font-size: 13px; font-weight: 600; color: #7878A0;
          text-decoration: none; transition: color 0.2s;
        }
        .set-back:hover { color: #F0F0FF; }
        .set-main {
          flex: 1; width: 100%; max-width: 620px;
          margin: 0 auto; padding: 48px 24px 72px;
        }
        .set-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 24px; font-weight: 700; letter-spacing: -0.5px;
          color: #F0F0FF; margin: 0 0 6px;
        }
        .set-sub { font-size: 13px; color: #7878A0; line-height: 1.6; margin: 0 0 26px; }
        .set-note { text-align: center; padding: 60px 0; font-size: 13px; color: #5A5A80; }
        .set-card {
          background: #09091A; border: 1px solid #1E1E3A;
          border-radius: 16px; padding: 22px 24px; margin-bottom: 14px;
        }
        .set-card-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 15px; font-weight: 700; color: #F0F0FF; margin-bottom: 16px;
        }
        .set-form { display: flex; flex-direction: column; }
        .set-label {
          font-size: 12px; font-weight: 600; color: #9898C0; margin-bottom: 7px;
        }
        .set-row { display: flex; gap: 10px; }
        .set-input {
          flex: 1; min-width: 0;
          background: #0D0D22; border: 1px solid #2A2A4A; border-radius: 9px;
          padding: 11px 14px; color: #F0F0FF; font-size: 13px;
          font-family: Inter, sans-serif; outline: none; transition: border-color 0.2s;
        }
        .set-input:focus { border-color: #8B5CF6; }
        .set-input::placeholder { color: #4A4A6A; }
        .set-btn {
          padding: 11px 22px; border-radius: 9px; border: none; flex-shrink: 0;
          background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4);
          color: #fff;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.25s;
        }
        .set-btn:hover:not(:disabled) {
          box-shadow: 0 8px 24px rgba(139,92,246,.4);
          transform: translateY(-1px);
        }
        .set-btn:disabled { opacity: 0.5; cursor: default; }
        .set-current { font-size: 13px; color: #7878A0; margin-bottom: 14px; }
        .set-current-val { color: #F0F0FF; font-weight: 600; }
        .set-ok {
          margin-top: 10px; font-size: 12px; color: #34D399; line-height: 1.6;
        }
        .set-err {
          margin-top: 10px; font-size: 12px; color: #F87171; line-height: 1.6;
        }
        .set-info-row {
          display: flex; justify-content: space-between; align-items: baseline;
          font-size: 13px; color: #7878A0; padding: 8px 0;
          border-bottom: 1px solid #14142A;
        }
        .set-info-row:last-child { border-bottom: none; }
        .set-info-val { color: #F0F0FF; font-weight: 600; }
        .set-danger { border-color: rgba(248,113,113,.25); }
        .set-danger-txt { flex: 1; font-size: 13px; color: #7878A0; }
        .set-btn-danger {
          background: transparent; border: 1px solid rgba(248,113,113,.5);
          color: #F87171;
        }
        .set-btn-danger:hover:not(:disabled) {
          box-shadow: 0 8px 24px rgba(248,113,113,.2);
          border-color: #F87171;
        }
        .set-danger-note {
          margin-top: 14px; font-size: 12px; color: #5A5A80; line-height: 1.6;
        }
        /* PasswordInput ships its own au-* class names, styled only inside the
           auth layout — replicate those rules here so it renders identically. */
        .au-input {
          width: 100%; padding: 13px 16px; border-radius: 10px;
          background: #080814; border: 1px solid #1E1E3A; color: #F0F0FF;
          font-family: var(--font-inter), 'Inter', sans-serif;
          font-size: 14px; outline: none; transition: border-color .2s;
          box-sizing: border-box;
        }
        .au-input:focus { border-color: rgba(139,92,246,.6); }
        .au-input::placeholder { color: #3A3A60; }
        .au-pw-wrap { position: relative; }
        .au-pw-wrap .au-input { padding-right: 44px; }
        .au-pw-toggle {
          position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
          background: none; border: none; padding: 0; cursor: pointer;
          color: #3A3A60; transition: color .2s; display: flex; align-items: center;
          line-height: 0;
        }
        .au-pw-toggle:hover { color: #C4C4E0; }
        @media (max-width: 640px) {
          .set-head { padding: 14px 20px; }
          .set-main { padding-top: 28px; }
          .set-row { flex-direction: column; }
        }
      `}</style>
    </>
  )
}
