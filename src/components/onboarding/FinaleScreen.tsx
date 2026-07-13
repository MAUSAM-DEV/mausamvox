'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Persona } from './OnboardingPage'

// Every line and chip here must describe something the app really delivers
// today — this screen used to claim a demo clone, a share feature, and
// entitlements that never existed.
const FINALE_SUB: Record<Persona, string> = {
  artist:
    'Next: train a clone of your voice, then hear yourself sing any song.',
  producer:
    "Next: clone your own artist's voice and use it on every beat you make.",
  creator:
    'Swap the voice on a track, download the MP3, and post it anywhere.',
}

const UNLOCKS = [
  { value: '500', label: 'free credits added' },
  { value: '2',   label: 'free previews per track' },
  { value: '3',   label: 'creator tools unlocked' },
]

interface FinaleScreenProps {
  persona: Persona
}

export function FinaleScreen({ persona }: FinaleScreenProps) {
  const router = useRouter()
  const [userName, setUserName] = useState('')

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      const u = data.user
      if (!u) return
      const name = (u.user_metadata?.full_name ?? u.user_metadata?.name ?? '') as string
      const email = u.email ?? ''
      setUserName(name || email.split('@')[0])
    })
  }, [])

  return (
    <>
      <div className="ob-screen ob-sc-center">
        <div className="obf-badge">🎉</div>
        <h1 className="ob-h1">
          {userName ? (
            <>You&apos;re in, <span className="ob-gt">{userName}</span>.</>
          ) : (
            <>You&apos;re in.</>
          )}
        </h1>
        <p className="ob-sub">{FINALE_SUB[persona]}</p>

        <div className="obf-unlock-row">
          {UNLOCKS.map(u => (
            <span key={u.label} className="obf-unlock">
              ✓ <b>{u.value}</b> {u.label}
            </span>
          ))}
        </div>

        {/* Single CTA — the old "Share my first track" button faked a share
            feature (toast only) for a track that doesn't exist yet. */}
        <div className="ob-btn-row">
          <button
            className="ob-btn-big"
            onClick={() => router.push('/voice-swap')}
          >
            Enter MausamVox
          </button>
        </div>
      </div>

      <style suppressHydrationWarning>{`
        .obf-badge {
          width: 84px; height: 84px; border-radius: 50%; margin: 0 auto 22px;
          background: rgba(16,185,129,.08); border: 2px solid rgba(16,185,129,.35);
          display: flex; align-items: center; justify-content: center; font-size: 36px;
          animation: obfPop .55s cubic-bezier(.34,1.56,.64,1);
        }
        @keyframes obfPop {
          from { transform: scale(0) rotate(-20deg); }
          to   { transform: scale(1) rotate(0); }
        }
        .obf-unlock-row {
          display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-bottom: 34px;
        }
        .obf-unlock {
          padding: 8px 16px; border-radius: 99px;
          background: #121225; border: 1px solid #2E2E56;
          font-size: 12px; color: #C4C4E0; font-weight: 500;
          display: flex; align-items: center; gap: 7px;
        }
        .obf-unlock b { color: #9D5CFF; }
        @media (max-width: 760px) {
          .obf-unlock-row { flex-direction: column; align-items: center; }
        }
      `}</style>
    </>
  )
}
