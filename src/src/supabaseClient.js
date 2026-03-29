import { createClient } from '@supabase/supabase-js'

export const supabase = createClient('https://xhhmxabftbyxrirvvihn.supabase.co', 'sb_publishable_NZHoIxqqpSvVBP8MrLHCYA_gmg1AbN-')

export const TABLES = {
  users: 'uNMexs7BYTXQ2_dream_team_fantasy_draft_app_users',
  rooms: 'uNMexs7BYTXQ2_dream_team_fantasy_draft_draft_rooms',
  members: 'uNMexs7BYTXQ2_dream_team_fantasy_draft_room_members',
  players: 'uNMexs7BYTXQ2_dream_team_fantasy_draft_players_pool',
  picks: 'uNMexs7BYTXQ2_dream_team_fantasy_draft_draft_picks',
  matchups: 'uNMexs7BYTXQ2_dream_team_fantasy_draft_matchups',
  botMatches: 'uNMexs7BYTXQ2_dream_team_fantasy_draft_bot_matches'
}
