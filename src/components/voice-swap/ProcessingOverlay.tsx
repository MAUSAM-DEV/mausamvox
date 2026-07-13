'use client'

export type StepStatus = 'pending' | 'active' | 'done'

const STEP_LABELS = [
  'Isolating vocals — Studio Engine',
  'Applying your voice clone',
  'Mixing stems back together',
  'Scoring output quality',
]

interface ProcessingOverlayProps {
  visible: boolean
  type: 'preview' | 'full'
  steps: StepStatus[]
}

export function ProcessingOverlay({ visible, type, steps }: ProcessingOverlayProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 400,
        background: 'rgba(5,5,15,.88)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'all' : 'none',
        transition: 'opacity 0.3s',
      }}
    >
      <div
        style={{
          width: '96px',
          height: '96px',
          borderRadius: '50%',
          marginBottom: '28px',
          background: 'radial-gradient(circle, rgba(157,92,255,.45), rgba(249,69,158,.2) 50%, transparent 70%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '36px',
          animation: 'ovOrb 3s ease-in-out infinite',
        }}
      >
        🎤
      </div>

      <div
        style={{
          fontFamily: 'var(--font-grotesk), "Space Grotesk", sans-serif',
          fontSize: '20px',
          fontWeight: 600,
          marginBottom: '6px',
          color: '#F0F0FF',
        }}
      >
        {type === 'preview' ? 'Generating Preview' : 'Processing Your Swap'}
      </div>

      <div style={{ fontSize: '12px', color: '#8E8EB4', marginBottom: '28px' }}>
        {type === 'preview'
          ? 'First 2 previews of a track are free · 50 credits after'
          : 'Studio Engine · Studio Clone'}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '300px' }}>
        {STEP_LABELS.map((label, i) => {
          const s = steps[i] ?? 'pending'
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '9px 14px',
                borderRadius: '8px',
                background:
                  s === 'done'
                    ? 'rgba(16,185,129,.04)'
                    : s === 'active'
                    ? 'rgba(157,92,255,.06)'
                    : '#121225',
                border: `1px solid ${
                  s === 'done'
                    ? 'rgba(16,185,129,.2)'
                    : s === 'active'
                    ? 'rgba(157,92,255,.28)'
                    : '#2E2E56'
                }`,
                fontSize: '12px',
                color: s === 'pending' ? '#8E8EB4' : '#F0F0FF',
                transition: 'all 0.4s',
              }}
            >
              <div
                style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  flexShrink: 0,
                  background:
                    s === 'done'
                      ? 'rgba(16,185,129,.18)'
                      : s === 'active'
                      ? '#9D5CFF'
                      : '#2E2E56',
                  color:
                    s === 'done'
                      ? '#10B981'
                      : s === 'active'
                      ? '#fff'
                      : '#8E8EB4',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '9px',
                  fontWeight: 700,
                  animation: s === 'active' ? 'ovPip 1s ease infinite' : 'none',
                  transition: 'all 0.4s',
                }}
              >
                {s === 'done' ? '✓' : i + 1}
              </div>
              {label}
            </div>
          )
        })}
      </div>

      <style suppressHydrationWarning>{`
        @keyframes ovOrb { 0%,100% { transform: scale(1); } 50% { transform: scale(1.14); } }
        @keyframes ovPip { 0%,100% { box-shadow: 0 0 0 0 rgba(157,92,255,.4); } 50% { box-shadow: 0 0 0 4px rgba(157,92,255,.15); } }
      `}</style>
    </div>
  )
}
