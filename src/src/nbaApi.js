const API_BASE = 'https://www.thesportsdb.com/api/v1/json/3'
const LEAGUE_ID = '4387'

export async function fetchLeagueMeta() {
  const response = await fetch(`${API_BASE}/lookupleague.php?id=${LEAGUE_ID}`)
  if (!response.ok) throw new Error('Failed to load NBA league metadata.')
  const data = await response.json()
  return data?.leagues?.[0] || null
}

export async function searchPlayers(query) {
  if (!query?.trim()) return []
  const response = await fetch(`${API_BASE}/searchplayers.php?p=${encodeURIComponent(query.trim())}`)
  if (!response.ok) throw new Error('Failed to search NBA players.')
  const data = await response.json()
  return (data?.player || []).filter((player) => player?.strSport === 'Basketball')
}

export async function loadFeaturedPlayers() {
  const names = [
    'LeBron James',
    'Stephen Curry',
    'Nikola Jokic',
    'Jayson Tatum',
    'Giannis Antetokounmpo',
    'Luka Doncic',
    'Kevin Durant',
    'Anthony Edwards',
    'Shai Gilgeous-Alexander',
    'Victor Wembanyama',
    'Jalen Brunson',
    'Donovan Mitchell'
  ]

  const results = await Promise.all(names.map(async (name) => {
    try {
      const players = await searchPlayers(name)
      return players?.[0] || null
    } catch (_error) {
      return null
    }
  }))

  return results.filter(Boolean).map((player, index) => {
    const fantasyPoints = 38 + ((index * 7) % 19)
    return {
      player_id: player.idPlayer,
      full_name: player.strPlayer,
      team: player.strTeam || 'NBA',
      position: player.strPosition || 'Flex',
      headshot_url: player.strCutout || player.strThumb || '',
      stats_json: {
        status: player.strStatus || 'Active',
        nationality: player.strNationality || 'Unknown'
      },
      fantasy_points: fantasyPoints,
      is_active: true
    }
  })
}
