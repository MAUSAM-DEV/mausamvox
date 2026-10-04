'use client'

import { useState, type CSSProperties } from 'react'

// A range slider that keeps its existing look at rest and, on hover / keyboard
// focus / drag, becomes a "Suno-style" slider: thicker track with a filled bar,
// a visible handle, and the value shown live above the handle. Movement is the
// native input's: dragging snaps to `step`, arrow keys move exactly one step.
// Styles live in globals.css (.step-slider).
export interface StepSliderProps {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  disabled?: boolean
  className?: string                 // the slider's existing class (its at-rest look)
  style?: CSSProperties              // e.g. the existing --pct variable
  format?: (v: number) => string     // value shown in the bubble
  id?: string
  'aria-label'?: string
  'aria-valuetext'?: string
}

export function StepSlider({
  value, min, max, step = 1, onChange, disabled, className = '', style, format = (v) => String(v), id,
  ...aria
}: StepSliderProps) {
  const [dragging, setDragging] = useState(false)
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0
  return (
    <span
      className={`step-slider${dragging ? ' step-slider--drag' : ''}${disabled ? ' step-slider--off' : ''}`}
      style={{ '--fill': `${pct}%`, '--fill-n': pct / 100 } as CSSProperties}
    >
      <input
        id={id}
        type="range"
        className={`step-slider-input ${className}`}
        style={style}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerDown={() => setDragging(true)}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onBlur={() => setDragging(false)}
        {...aria}
      />
      <span className="step-slider-bubble" aria-hidden="true">{format(value)}</span>
    </span>
  )
}
