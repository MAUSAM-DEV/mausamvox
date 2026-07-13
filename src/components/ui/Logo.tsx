'use client'

interface LogoProps {
  size?: number
  className?: string
}

export function LogoMark({ size = 38, className }: LogoProps) {
  return (
    <svg
      viewBox="0 0 38 38"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      className={className}
    >
      <defs>
        <linearGradient id="logoGrad" x1="0" y1="0" x2="38" y2="38" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9D5CFF" />
          <stop offset=".5" stopColor="#F9459E" />
          <stop offset="1" stopColor="#0CC7E8" />
        </linearGradient>
      </defs>
      <rect x="1"  y="23" width="5" height="11" rx="2.5" fill="url(#logoGrad)" opacity=".45" />
      <rect x="8"  y="15" width="5" height="19" rx="2.5" fill="url(#logoGrad)" opacity=".65" />
      <rect x="15" y="6"  width="5" height="28" rx="2.5" fill="url(#logoGrad)" />
      <rect x="22" y="15" width="5" height="19" rx="2.5" fill="url(#logoGrad)" opacity=".65" />
      <rect x="29" y="23" width="5" height="11" rx="2.5" fill="url(#logoGrad)" opacity=".45" />
    </svg>
  )
}

export function LogoFull({ size = 38 }: LogoProps) {
  return (
    <a href="/" style={{ display: 'flex', alignItems: 'center', gap: '11px', textDecoration: 'none' }}>
      <LogoMark size={size} />
      <span
        style={{
          fontFamily: 'var(--font-grotesk), "Space Grotesk", sans-serif',
          fontSize: '20px',
          fontWeight: 700,
          letterSpacing: '-0.3px',
          color: '#F0F0FF',
        }}
      >
        Mausam
        <span className="grad-text">Vox</span>
      </span>
    </a>
  )
}
