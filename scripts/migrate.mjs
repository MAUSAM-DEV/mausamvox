#!/usr/bin/env node
// Runs supabase/migrations/*.sql against the remote project via the Management API.
// Usage:
//   SUPABASE_ACCESS_TOKEN=<token> node scripts/migrate.mjs
//
// Get your token at: https://supabase.com/dashboard/account/tokens

import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir  = dirname(fileURLToPath(import.meta.url))
const root   = join(__dir, '..')

// ── config ─────────────────────────────────────────────────────────────────

// Read project ref from .env.local
const envRaw = readFileSync(join(root, '.env.local'), 'utf8')
const urlLine = envRaw.split('\n').find(l => l.startsWith('NEXT_PUBLIC_SUPABASE_URL='))
if (!urlLine) { console.error('NEXT_PUBLIC_SUPABASE_URL not found in .env.local'); process.exit(1) }
const projectRef = urlLine.split('https://')[1]?.split('.')[0]
if (!projectRef) { console.error('Could not parse project ref from SUPABASE_URL'); process.exit(1) }

const accessToken = process.env.SUPABASE_ACCESS_TOKEN
if (!accessToken) {
  console.error('\nMissing SUPABASE_ACCESS_TOKEN.\n')
  console.error('1. Go to https://supabase.com/dashboard/account/tokens')
  console.error('2. Generate a new token')
  console.error('3. Run:  SUPABASE_ACCESS_TOKEN=<token> node scripts/migrate.mjs\n')
  process.exit(1)
}

// ── run migrations ─────────────────────────────────────────────────────────

const migrationsDir = join(root, 'supabase', 'migrations')
const files = readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .sort()

console.log(`\nProject:    ${projectRef}`)
console.log(`Migrations: ${files.length} file(s)\n`)

for (const file of files) {
  const sql = readFileSync(join(migrationsDir, file), 'utf8')
  process.stdout.write(`  Running ${file} … `)

  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ query: sql }),
    }
  )

  if (!res.ok) {
    const body = await res.text()
    console.error(`FAILED (${res.status})\n${body}`)
    process.exit(1)
  }

  console.log('done ✓')
}

console.log('\nAll migrations applied successfully.\n')
