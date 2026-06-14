'use client'

import { useRef } from 'react'

// Sections are always visible. Content must never be hidden by JS.
// The ref is kept so call-sites don't need changing; visible is always true.
export function useReveal(_threshold = 0.08) {
  const ref = useRef<HTMLElement | HTMLDivElement>(null)
  return { ref, visible: true as const }
}
