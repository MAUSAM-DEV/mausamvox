'use client'

// Indian languages first (voice swap is language-agnostic — RVC re-voices
// phonemes), then global reach. Marquee CSS lives in globals.css
// (.lang-marquee / .lang-track / .lang-set); reduced motion falls back to
// the old static wrapped row.
const langs = [
  '🇮🇳 Hindi',
  '🇮🇳 Bengali',
  '🇮🇳 Tamil',
  '🇮🇳 Telugu',
  '🇮🇳 Punjabi',
  '🇮🇳 Marathi',
  '🇬🇧 English',
  '🇪🇸 Spanish',
  '🇫🇷 French',
  '🇩🇪 German',
  '🇯🇵 Japanese',
  '🇰🇷 Korean',
  '🇧🇷 Portuguese',
  '🇸🇦 Arabic',
  '+ more coming',
]

export function LangStrip() {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '52px 0',
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
      <div className="lang-marquee">
        <div className="lang-track">
          <div className="lang-set">
            {langs.map((lang) => (
              <LangPill key={lang} label={lang} />
            ))}
          </div>
          {/* duplicate set = the seamless wrap; hidden from screen readers */}
          <div className="lang-set lang-set-dup" aria-hidden="true">
            {langs.map((lang) => (
              <LangPill key={lang} label={lang} />
            ))}
          </div>
        </div>
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
        whiteSpace: 'nowrap',
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
