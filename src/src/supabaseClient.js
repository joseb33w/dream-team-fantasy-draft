import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

const SUPABASE_URL = 'https://xhhmxabftbyxrirvvihn.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_NZHoIxqqpSvVBP8MrLHCYA_gmg1AbN-'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const P = 'uNMexs7BYTXQ2_dream_team_fantasy_draft_'
export const TABLES = {
  users:      P + 'users',
  rooms:      P + 'rooms',
  members:    P + 'members',
  players:    P + 'players',
  picks:      P + 'picks',
  matchups:   P + 'matchups',
  botMatches: P + 'bot_matches'
}
