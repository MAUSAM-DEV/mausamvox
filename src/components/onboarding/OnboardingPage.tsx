'use client'

import { useCallback, useEffect, useState } from 'react'
import { OBTopbar } from './OBTopbar'
import { PersonaScreen } from './PersonaScreen'
import { ActionScreen } from './ActionScreen'
import { MagicMomentScreen } from './MagicMomentScreen'
import { FinaleScreen } from './FinaleScreen'
import { VToast } from '@/components/voice-swap/VToast'

export type Persona = 'artist' | 'producer' | 'creator'

export function OnboardingPage() {
  const [screen, setScreen]           = useState<1 | 2 | 3 | 4>(1)
  const [persona, setPersona]         = useState<Persona>('artist')
  const [canContinue, setCanContinue] = useState(false)
  const [toast, setToast]             = useState({ visible: false, message: '' })

  const showToast = useCallback((m: string) => {
    setToast({ visible: true, message: m })
    setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 2800)
  }, [])

  // Lock body scroll on desktop to prevent double-scrollbar
  useEffect(() => {
    function apply() {
      document.body.style.overflow = window.innerWidth >= 760 ? 'hidden' : ''
    }
    apply()
    window.addEventListener('resize', apply)
    return () => {
      window.removeEventListener('resize', apply)
      document.body.style.overflow = ''
    }
  }, [])

  function handlePersonaPick(p: Persona) {
    setPersona(p)
    // producer/creator have a default option selected → can continue immediately
    setCanContinue(p !== 'artist')
    setScreen(2)
  }

  return (
    <>
      {/* ambient orbs */}
      <div className="ob-orb ob-orb1" />
      <div className="ob-orb ob-orb2" />
      <div className="ob-orb ob-orb3" />
      <div className="ob-bg-grid" />

      <div className="ob-stage">
        <OBTopbar
          screen={screen}
          onSkip={() => showToast('Skipping — taking you to the dashboard')}
        />

        {/* progress dots */}
        <div className="ob-dots">
          {([1, 2, 3, 4] as const).map(i => (
            <div
              key={i}
              className={
                `ob-dot${screen === i ? ' ob-dot--on' : screen > i ? ' ob-dot--past' : ''}`
              }
            />
          ))}
        </div>

        <div className="ob-screen-wrap">
          {screen === 1 && (
            <PersonaScreen key="sc1" onPick={handlePersonaPick} />
          )}
          {screen === 2 && (
            <ActionScreen
              key="sc2"
              persona={persona}
              canContinue={canContinue}
              onCanContinue={() => setCanContinue(true)}
              onContinue={() => setScreen(3)}
              onToast={showToast}
            />
          )}
          {screen === 3 && (
            <MagicMomentScreen
              key="sc3"
              persona={persona}
              onNext={() => setScreen(4)}
            />
          )}
          {screen === 4 && (
            <FinaleScreen key="sc4" persona={persona} />
          )}
        </div>

        <div className="ob-foot-note">
          No credit card needed · <b>7-day refund</b> on every paid plan · Your voice stays private
        </div>
      </div>

      <VToast visible={toast.visible} message={toast.message} />

      <style suppressHydrationWarning>{`
        /* ── ambient orbs ─────────────────────────────── */
        .ob-orb {
          position: fixed; border-radius: 50%; pointer-events: none; z-index: 0; filter: blur(70px);
        }
        .ob-orb1 {
          width: 560px; height: 560px; top: -180px; left: -120px;
          background: radial-gradient(circle, rgba(139,92,246,.16), transparent 70%);
          animation: obDrift1 11s ease-in-out infinite;
        }
        .ob-orb2 {
          width: 480px; height: 480px; bottom: -160px; right: -100px;
          background: radial-gradient(circle, rgba(236,72,153,.12), transparent 70%);
          animation: obDrift2 13s ease-in-out infinite;
        }
        .ob-orb3 {
          width: 300px; height: 300px; top: 45%; left: 55%;
          background: radial-gradient(circle, rgba(6,182,212,.08), transparent 70%);
          animation: obDrift1 9s 2s ease-in-out infinite;
        }
        @keyframes obDrift1 {
          0%,100% { transform: translate(0,0) scale(1); }
          50%      { transform: translate(28px,18px) scale(1.07); }
        }
        @keyframes obDrift2 {
          0%,100% { transform: translate(0,0) scale(1); }
          50%      { transform: translate(-24px,-14px) scale(1.05); }
        }

        /* ── background grid ──────────────────────────── */
        .ob-bg-grid {
          position: fixed; inset: 0; z-index: 0; pointer-events: none;
          background-image:
            linear-gradient(rgba(255,255,255,.022) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,.022) 1px, transparent 1px);
          background-size: 72px 72px;
          mask-image: radial-gradient(ellipse 85% 75% at 50% 45%, black, transparent);
        }

        /* ── stage ────────────────────────────────────── */
        .ob-stage {
          position: relative; z-index: 1;
          height: 100vh; display: flex; flex-direction: column;
          align-items: center; padding: 0 24px;
        }

        /* ── progress dots ─────────────────────────────── */
        .ob-dots { display: flex; gap: 8px; align-items: center; padding-bottom: 26px; flex-shrink: 0; }
        .ob-dot { width: 7px; height: 7px; border-radius: 99px; background: #272745; transition: all .4s; }
        .ob-dot--on { width: 26px; background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4); }
        .ob-dot--past { background: #8B5CF6; }

        /* ── screen wrap ───────────────────────────────── */
        .ob-screen-wrap {
          flex: 1; width: 100%; max-width: 920px;
          display: flex; align-items: center; justify-content: center;
          overflow-y: auto; padding-bottom: 24px;
        }

        /* ── footer ────────────────────────────────────── */
        .ob-foot-note { font-size: 11px; color: #5A5A80; text-align: center; padding: 16px 0 22px; flex-shrink: 0; }
        .ob-foot-note b { color: #7878A0; }

        /* ── shared: screen animation ─────────────────── */
        .ob-screen { width: 100%; animation: obRise .45s cubic-bezier(.22,.8,.36,1); }
        @keyframes obRise {
          from { opacity: 0; transform: translateY(22px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ob-sc-center { text-align: center; }

        /* ── shared: typography ───────────────────────── */
        .ob-eyebrow {
          display: inline-block; font-size: 11px; font-weight: 700;
          letter-spacing: 3px; text-transform: uppercase;
          background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
          margin-bottom: 16px;
        }
        .ob-h1 {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: clamp(30px, 4.6vw, 46px);
          font-weight: 700; letter-spacing: -1.5px; line-height: 1.08; color: #F0F0FF;
          margin-bottom: 12px;
        }
        .ob-gt {
          background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        }
        .ob-sub {
          font-size: 15px; color: #5A5A80; max-width: 480px; margin: 0 auto 36px;
          font-family: var(--font-inter), 'Inter', sans-serif;
        }

        /* ── shared: buttons ──────────────────────────── */
        .ob-btn-row { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
        .ob-btn-big {
          padding: 15px 36px; border-radius: 10px; border: none;
          background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4); color: #fff;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 15px; font-weight: 600; cursor: pointer; transition: all .28s; letter-spacing: .2px;
        }
        .ob-btn-big:hover { transform: translateY(-2px); box-shadow: 0 14px 40px rgba(139,92,246,.45); }
        .ob-btn-big:disabled { opacity: .35; cursor: not-allowed; transform: none; box-shadow: none; }
        .ob-btn-quiet {
          padding: 14px 28px; border-radius: 10px;
          border: 1px solid #272745; background: rgba(255,255,255,.02);
          color: #C4C4E0; font-family: var(--font-inter), 'Inter', sans-serif;
          font-size: 14px; font-weight: 500; cursor: pointer; transition: all .25s;
        }
        .ob-btn-quiet:hover { border-color: rgba(139,92,246,.4); color: #F0F0FF; }

        /* ── mobile ───────────────────────────────────── */
        @media (max-width: 760px) {
          .ob-stage { padding: 0 16px; }
          .ob-screen-wrap { align-items: flex-start; padding-top: 6px; }
          .ob-h1 { letter-spacing: -1px; }
          .ob-sub { font-size: 13px; margin-bottom: 26px; }
          .ob-btn-row { flex-direction: column; align-items: stretch; }
          .ob-btn-big, .ob-btn-quiet { width: 100%; }
        }
      `}</style>
    </>
  )
}
