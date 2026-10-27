'use client'

// Shared toast. Sits ABOVE the pages' bottom action bars (2026-10-27: at 24 px it covered the
// Preview / Process buttons) and wraps long messages instead of running off a phone screen.
export function VToast({ visible, message }: { visible: boolean; message: string }) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 'calc(92px + env(safe-area-inset-bottom, 0px))',
        left: '50%',
        transform: `translateX(-50%) translateY(${visible ? '0' : '10px'})`,
        background: '#16162C',
        border: '1px solid #383866',
        borderRadius: '10px',
        padding: '10px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '13px',
        fontWeight: 500,
        color: '#F0F0FF',
        boxShadow: '0 12px 36px rgba(0,0,0,.5)',
        opacity: visible ? 1 : 0,
        transition: 'all 0.3s',
        pointerEvents: 'none',
        zIndex: 999,
        whiteSpace: 'normal',
        width: 'max-content',
        maxWidth: 'min(560px, calc(100vw - 32px))',
        lineHeight: 1.45,
      }}
    >
      <span
        style={{
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          background: '#10B981',
          boxShadow: '0 0 7px #10B981',
          flexShrink: 0,
          display: 'inline-block',
        }}
      />
      {message}
    </div>
  )
}
