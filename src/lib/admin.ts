// Accounts that bypass credit deduction — for founder/internal testing only.
// Credits are never touched (previews, full swaps, stem splits, gender splits)
// for any email in this list. Add or remove entries here; takes effect on
// the next deploy. Keep the list short and never commit real user emails.
export const ADMIN_EMAILS: ReadonlyArray<string> = [
  'mausam.theshadows@gmail.com',
]
