'use client'

const langs = [
  '🇬🇧 English',
  '🇮🇳 Hindi',
  '🇪🇸 Spanish',
  '🇫🇷 French',
  '🇩🇪 German',
  '🇯🇵 Japanese',
  '🇰🇷 Korean',
  '🇧🇷 Portuguese',
  '🇮🇳 Tamil',
  '🇮🇳 Bengali',
  '🇸🇦 Arabic',
  '+ more coming',
]

export function LangStrip() {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '52px 28px',
        borderTop: '1px solid rgba(255,255,255,.04)',
        borderBottom: '1px solid rgba(255,255,255,.04)',
      }}
    >
      <p
        style={{
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '2.5px',
          textTransform: 'uppercase',
          color: '#9494BC',
          marginBottom: '28px',
        }}
      >
        Supported Languages
      </p>
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
        {langs.map((lang) => (
          <LangPill key={lang} label={lang} />
        ))}
      </div>
    </div>
  )
}

function LangPill({ label }: { label: string }) {
  return (
    <span
      style={{
        padding: '7px 18px',
        borderRadius: '999px',
        border: '1px solid #2E2E56',
        background: '#0F0F22',
        fontSize: '13px',
        fontWeight: 500,
        color: '#C8C8E8',
        cursor: 'default',
        transition: 'all 0.25s',
        display: 'inline-block',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = '#9D5CFF'
        e.currentTarget.style.color = '#F0F0FF'
        e.currentTarget.style.background = 'rgba(157,92,255,.08)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '#2E2E56'
        e.currentTarget.style.color = '#C8C8E8'
        e.currentTarget.style.background = '#0F0F22'
      }}
    >
      {label}
    </span>
  )
}
