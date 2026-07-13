import type { ReactNode } from 'react'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="au-orb au-orb1" />
      <div className="au-orb au-orb2" />
      <div className="au-bg-grid" />
      <div className="au-center">{children}</div>

      <style suppressHydrationWarning>{`
        /* ── orbs ──────────────────────────────────────── */
        .au-orb {
          position: fixed; border-radius: 50%; pointer-events: none; z-index: 0;
          filter: blur(80px);
        }
        .au-orb1 {
          width: 520px; height: 520px; top: -160px; left: -100px;
          background: radial-gradient(circle, rgba(157,92,255,.15), transparent 70%);
          animation: auDrift1 11s ease-in-out infinite;
        }
        .au-orb2 {
          width: 420px; height: 420px; bottom: -120px; right: -80px;
          background: radial-gradient(circle, rgba(249,69,158,.1), transparent 70%);
          animation: auDrift2 13s ease-in-out infinite;
        }
        @keyframes auDrift1 {
          0%,100% { transform: translate(0,0) scale(1); }
          50%      { transform: translate(24px,16px) scale(1.06); }
        }
        @keyframes auDrift2 {
          0%,100% { transform: translate(0,0) scale(1); }
          50%      { transform: translate(-20px,-12px) scale(1.04); }
        }

        /* ── background grid ───────────────────────────── */
        .au-bg-grid {
          position: fixed; inset: 0; z-index: 0; pointer-events: none;
          background-image:
            linear-gradient(rgba(255,255,255,.022) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,.022) 1px, transparent 1px);
          background-size: 72px 72px;
          mask-image: radial-gradient(ellipse 85% 75% at 50% 45%, black, transparent);
        }

        /* ── centering shell ───────────────────────────── */
        .au-center {
          position: relative; z-index: 1;
          height: 100vh; overflow-y: auto;
          display: flex; align-items: center;
          justify-content: center; padding: 40px 20px;
          box-sizing: border-box;
        }

        /* ── card ──────────────────────────────────────── */
        .au-card {
          width: 100%; max-width: 420px;
          background: #0D0D1F; border: 1px solid #2E2E56; border-radius: 20px;
          padding: 40px 36px;
          animation: auSlide .45s cubic-bezier(.22,.8,.36,1);
        }
        @keyframes auSlide {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* ── logo row ──────────────────────────────────── */
        .au-logo-row {
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 30px;
        }

        /* ── typography ────────────────────────────────── */
        .au-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 23px; font-weight: 700; color: #F0F0FF;
          margin-bottom: 6px; text-align: center;
        }
        .au-subtitle {
          font-size: 14px; color: #8E8EB4; text-align: center; margin-bottom: 28px;
          font-family: var(--font-inter), 'Inter', sans-serif;
        }

        /* ── form ──────────────────────────────────────── */
        .au-form { display: flex; flex-direction: column; gap: 18px; }
        .au-field { display: flex; flex-direction: column; gap: 7px; }
        .au-label-row {
          display: flex; align-items: center; justify-content: space-between;
        }
        .au-label {
          font-size: 13px; font-weight: 500; color: #C4C4E0;
          font-family: var(--font-inter), 'Inter', sans-serif;
        }
        .au-input {
          width: 100%; padding: 13px 16px; border-radius: 10px;
          background: #080814; border: 1px solid #2E2E56; color: #F0F0FF;
          font-family: var(--font-inter), 'Inter', sans-serif;
          font-size: 14px; outline: none; transition: border-color .2s;
          box-sizing: border-box;
        }
        .au-input:focus { border-color: rgba(157,92,255,.6); }
        .au-input::placeholder { color: #4A4A7A; }

        /* ── password show/hide ────────────────────────── */
        .au-pw-wrap { position: relative; }
        .au-pw-wrap .au-input { padding-right: 44px; }
        .au-pw-toggle {
          position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
          background: none; border: none; padding: 0; cursor: pointer;
          color: #4A4A7A; transition: color .2s; display: flex; align-items: center;
          line-height: 0;
        }
        .au-pw-toggle:hover { color: #C4C4E0; }

        /* ── button ────────────────────────────────────── */
        .au-btn {
          width: 100%; padding: 14px; border-radius: 10px; border: none;
          background: linear-gradient(135deg, #9D5CFF, #F9459E, #0CC7E8);
          color: #fff; font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 15px; font-weight: 600; cursor: pointer; transition: all .28s;
          letter-spacing: .2px; margin-top: 4px;
        }
        .au-btn:hover { transform: translateY(-2px); box-shadow: 0 14px 40px rgba(157,92,255,.4); }
        .au-btn:disabled { opacity: .4; cursor: not-allowed; transform: none; box-shadow: none; }

        /* ── links ─────────────────────────────────────── */
        .au-link {
          background: linear-gradient(135deg, #9D5CFF, #F9459E, #0CC7E8);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
          font-weight: 600; text-decoration: none;
        }
        .au-link-sm {
          font-size: 12px; color: #8E8EB4; text-decoration: none; transition: color .2s;
        }
        .au-link-sm:hover { color: #9D5CFF; }
        .au-footer-link {
          font-size: 13px; color: #8E8EB4; text-align: center; margin-top: 22px;
          font-family: var(--font-inter), 'Inter', sans-serif;
        }

        /* ── feedback ──────────────────────────────────── */
        .au-error {
          padding: 11px 14px; border-radius: 9px;
          background: rgba(239,68,68,.08); border: 1px solid rgba(239,68,68,.2);
          font-size: 13px; color: #F87171; margin-bottom: 2px;
          font-family: var(--font-inter), 'Inter', sans-serif;
        }

        /* ── email-sent / success state ────────────────── */
        .au-sent { text-align: center; padding: 8px 0; }
        .au-sent-icon {
          font-size: 40px; margin-bottom: 16px;
          display: block;
          animation: auPop .5s cubic-bezier(.34,1.56,.64,1);
        }
        @keyframes auPop {
          from { transform: scale(0) rotate(-15deg); }
          to   { transform: scale(1) rotate(0); }
        }
        .au-sent-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 20px; font-weight: 700; color: #F0F0FF; margin-bottom: 10px;
        }
        .au-sent-sub {
          font-size: 13px; color: #8E8EB4; line-height: 1.65;
          font-family: var(--font-inter), 'Inter', sans-serif;
        }

        /* ── mobile ────────────────────────────────────── */
        @media (max-width: 480px) {
          .au-card { padding: 28px 20px; border-radius: 16px; }
          .au-title { font-size: 20px; }
          .au-center { padding: 20px 16px; }
        }
      `}</style>
    </>
  )
}
