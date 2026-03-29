import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://xhhmxabftbyxrirvvihn.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_NZHoIxqqpSvVBP8MrLHCYA_gmg1AbN-'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export const TABLE_PREFIX = 'uNMexs7BYTXQ2_dream_team_fantasy_draft_'
export const TABLES = {
  users:      TABLE_PREFIX + 'users',
  rooms:      TABLE_PREFIX + 'rooms',
  members:    TABLE_PREFIX + 'members',
  players:    TABLE_PREFIX + 'players',
  picks:      TABLE_PREFIX + 'picks',
  matchups:   TABLE_PREFIX + 'matchups',
  botMatches: TABLE_PREFIX + 'bot_matches',
}