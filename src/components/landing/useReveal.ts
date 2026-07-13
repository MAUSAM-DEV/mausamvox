'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// Scroll-reveal. Content must never be hidden by JS failure: sections render
// VISIBLE by default (SSR markup, no-JS, reduced-motion, no IntersectionObserver).
// Only after hydration, and only for sections still below the fold, does JS
// hide them — then reveals ONCE on first intersection (no re-hide on scroll up).
// The first version of this hook shipped hidden-by-default and left sections
// invisible; keep this invariant if you touch it.

const useClientLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

export function useReveal(threshold = 0.08) {
  const ref = useRef<HTMLElement | HTMLDivElement>(null)
  const [visible, setVisible] = useState(true)

  useClientLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // Degenerate viewport (headless/embedded edge case): a 0-height root can
    // never intersect, which would hide content forever. Stay visible.
    if (window.innerHeight < 200) return
    // Already on screen at hydration: leave it static — no hide/reveal flash.
    if (el.getBoundingClientRect().top < window.innerHeight * 0.85) return

    setVisible(false)
    el.classList.add('rv-wait')
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          el.classList.remove('rv-wait')
          el.classList.add('rv-go')
          io.disconnect()
        }
      },
      { threshold },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [threshold])

  return { ref, visible }
}
