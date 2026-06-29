# CLAUDE.md — Agent working rules for MausamVox

## How I work (read this first)

- **I'm a non-coder.** I direct you one step at a time. Don't run ahead — do the single step I asked for, then stop.
- **You do all file edits.** Never hand me raw terminal commands to run myself, unless I explicitly ask for one.
- **I test exclusively on live Vercel**, never locally. The order is always: **commit → push → wait for Vercel "Ready" → test**. Don't ask me to test before it's pushed and Ready.
- **Keep responses point-wise and copy-paste-ready.** Short bullets. If something needs pasting (a value, a setting), give it clean with no surrounding prose.

## Recurring gotchas (don't relearn these the hard way)

- **`voice_swaps` GRANTs:** every new DB operation on `voice_swaps` needs its own explicit `GRANT` for **both** `authenticated` **and** `service_role`. No RLS on this table — access is grants + app-code ownership checks. Adding a query/insert/update? Add the matching grant migration.
- **Never store expiring signed URLs.** Store the durable storage **path** in the DB, and **sign fresh at the moment of use**. Stale signed URLs are the #1 cause of "it worked yesterday" failures.
- **Supabase branching must stay OFF.** Do not enable it.
- **RVC is deterministic.** Same input + same model + same params → same output. (We pass a random seed only to dodge Replicate's prediction cache, not to change the voice.)

## Session handoff protocol

At the end of **every completed step or session**, you must:

1. **Update `PROJECT_STATUS.md`** to reflect the current state.
2. **Append a dated one-line entry to `CHANGELOG.md`** including the commit hash.
3. **Commit** all changed handoff files.
4. **Push to `main`.**

When I say **"wrap up"** or **"end session,"** do all four before stopping.
