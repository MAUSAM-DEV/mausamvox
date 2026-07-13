'use client'

export function VToast({ visible, message }: { visible: boolean; message: string }) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
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
        whiteSpace: 'nowrap',
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
