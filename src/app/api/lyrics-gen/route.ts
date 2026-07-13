import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'
import { ADMIN_EMAILS } from '@/lib/admin'
import { logReplicateTiming } from '@/lib/replicate-timing'
import {
  LYRICS_GEN_VERSION,
  LYRICS_GEN_CREDITS,
  LYRICS_THEME_MAX,
  LYRICS_MOOD_MAX,
  LYRICS_GEN_LANGUAGES,
  LYRICS_GEN_STRUCTURES,
} from '@/lib/lyrics-gen'

// AI lyrics generator — theme/mood/language → [verse]/[chorus]/[bridge]-tagged
// lyrics that drop straight into Song Studio's textarea (engine + pricing
// rationale in src/lib/lyrics-gen.ts). Synchronous: the LLM answers in ~3-8s,
// well inside maxDuration, so no create+poll dance.
//
// Credits: Choir/Instruments pattern — atomic deduct_credits() BEFORE the
// paid call, add_credits() refund on EVERY failure path after the charge,
// ADMIN_EMAILS bypass. Nothing is stored server-side: the result goes into
// the editable textarea and the user owns it from there.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYSTEM_PROMPT =
  'You are a professional songwriter. Output ONLY song lyrics — no title, no commentary, no explanations, no markdown. ' +
  'Structure the lyrics with section tags on their own lines, lowercase, exactly like: [verse] [chorus] [bridge]. ' +
  'Write original lyrics only — never reproduce or imitate the lyrics of existing songs.'

const POLL_MS = 1000
const POLL_CEILING_MS = 50000 // LLM typically answers in ~3-8s; stay inside maxDuration

// Best-effort atomic refund — never throws (Choir/Instruments pattern).
async function refundCredits(userId: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc('add_credits', {
      p_user_id: userId,
      p_amount: LYRICS_GEN_CREDITS,
    })
    if (error) console.error('[lyrics-gen] refund failed:', error.message)
  } catch (err) {
    console.error('[lyrics-gen] refund threw:', err instanceof Error ? err.message : String(err))
  }
}

// The system prompt bans commentary, but belt-and-braces: cut any preamble
// before the first section tag, strip markdown fences and per-line trailing
// spaces (the model emits markdown-style double-space line breaks).
function sanitizeLyrics(raw: string): string {
  let text = raw.replace(/```[a-z]*\n?/g, '').trim()
  const firstTag = text.search(/\[(verse|chorus|bridge|intro|outro|pre-chorus|hook)\b/i)
  if (firstTag > 0) text = text.slice(firstTag)
  return text
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .trim()
    .slice(0, 5000) // Song Studio's textarea/route cap
}

export async function POST(req: NextRequest) {
  let chargedUserId: string | null = null
  try {
    if (!adminConfigured) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }
    if (!process.env.REPLICATE_API_TOKEN) {
      return NextResponse.json({ error: 'Replicate API token not configured' }, { status: 500 })
    }

    const sessionClient = await createClient()
    const { data: { user } } = await sessionClient.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }

    let body: { theme?: unknown; language?: unknown; mood?: unknown; structure?: unknown }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const theme = typeof body.theme === 'string' ? body.theme.trim().slice(0, LYRICS_THEME_MAX) : ''
    if (theme.length < 3) {
      return NextResponse.json({ error: 'Give the song a theme — a few words is enough' }, { status: 400 })
    }
    const language = LYRICS_GEN_LANGUAGES.find((l) => l.id === body.language)
    if (!language) {
      return NextResponse.json({ error: 'Unknown language' }, { status: 400 })
    }
    const structure = LYRICS_GEN_STRUCTURES.find((s) => s.id === (body.structure ?? 'auto'))
    if (!structure) {
      return NextResponse.json({ error: 'Unknown structure' }, { status: 400 })
    }
    const mood = typeof body.mood === 'string' ? body.mood.trim().slice(0, LYRICS_MOOD_MAX) : ''

    // ── Charge BEFORE the paid call (atomic; refunded on any failure below) ──
    const isAdmin = ADMIN_EMAILS.includes(user.email ?? '')
    if (!isAdmin) {
      const { error: debitError } = await supabaseAdmin.rpc('deduct_credits', {
        p_user_id: user.id,
        p_amount: LYRICS_GEN_CREDITS,
      })
      if (debitError) {
        if (debitError.message.includes('INSUFFICIENT_CREDITS')) {
          return NextResponse.json({ error: 'Insufficient credits' }, { status: 402 })
        }
        console.error('[lyrics-gen] debit failed:', debitError.message)
        return NextResponse.json({ error: 'Failed to deduct credits' }, { status: 500 })
      }
      chargedUserId = user.id
    }

    const prompt = [
      'Write original song lyrics.',
      `Theme: ${theme}`,
      `Language: ${language.instruction}`,
      mood ? `Mood/style: ${mood}` : null,
      `Structure: ${structure.instruction}`,
    ].filter(Boolean).join('\n')

    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
    let prediction = await replicate.predictions.create({
      version: LYRICS_GEN_VERSION,
      input: {
        prompt,
        system_prompt: SYSTEM_PROMPT,
        max_completion_tokens: 1200,
        // Some creative variance so a retry gives a different draft.
        temperature: 0.8,
      },
    })

    const deadline = Date.now() + POLL_CEILING_MS
    while (prediction.status === 'starting' || prediction.status === 'processing') {
      if (Date.now() > deadline) {
        if (chargedUserId) await refundCredits(chargedUserId)
        return NextResponse.json({ error: 'Lyrics generation timed out — credits refunded, try again' }, { status: 504 })
      }
      await new Promise((r) => setTimeout(r, POLL_MS))
      prediction = await replicate.predictions.get(prediction.id)
    }

    if (prediction.status !== 'succeeded') {
      const msg = typeof prediction.error === 'string' ? prediction.error : JSON.stringify(prediction.error)
      console.error(`[lyrics-gen] prediction ${prediction.id} ${prediction.status}:`, msg)
      if (chargedUserId) await refundCredits(chargedUserId)
      return NextResponse.json({ error: 'Lyrics generation failed — credits refunded, try again' }, { status: 502 })
    }

    logReplicateTiming('lyrics-gen', prediction)

    const out = prediction.output
    const raw = Array.isArray(out) ? out.join('') : typeof out === 'string' ? out : ''
    const text = sanitizeLyrics(raw)
    if (!text) {
      if (chargedUserId) await refundCredits(chargedUserId)
      return NextResponse.json({ error: 'The model returned no lyrics — credits refunded, try again' }, { status: 502 })
    }

    console.log(`[lyrics-gen] ${text.length} chars (${language.id}, ${structure.id}) for ${user.id}`)
    return NextResponse.json({ lyrics: text })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[lyrics-gen] failed:', msg)
    if (chargedUserId) await refundCredits(chargedUserId)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
