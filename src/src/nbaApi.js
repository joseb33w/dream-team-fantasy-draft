const SPORTS_DB_BASE = 'https://www.thesportsdb.com/api/v1/json/3'

export async function searchPlayers(query) {
  if (!query || query.length < 2) return []
  try {
    const res = await fetch(`${SPORTS_DB_BASE}/searchplayers.php?p=${encodeURIComponent(query)}`)
    const data = await res.json()
    if (!data.player) return []
    return data.player
      .filter(p => p.strSport === 'Basketball' && (p.strTeam || '').length > 0)
      .slice(0, 20)
      .map(p => ({
        id: p.idPlayer,
        name: p.strPlayer,
        team: p.strTeam || 'Free Agent',
        position: p.strPosition || 'N/A',
        thumb: p.strThumb || p.strCutout || null,
        nationality: p.strNationality || '',
        birthDate: p.dateBorn || '',
        description: p.strDescriptionEN ? p.strDescriptionEN.slice(0, 200) : '',
        fantasyPts: Math.floor(Math.random() * 25) + 15,
      }))
  } catch (err) {
    console.error('Player search failed:', err)
    return []
  }
}

const FEATURED_NAMES = [
  'LeBron James', 'Stephen Curry', 'Kevin Durant', 'Giannis Antetokounmpo',
  'Luka Doncic', 'Nikola Jokic', 'Joel Embiid', 'Jayson Tatum',
  'Anthony Edwards', 'Shai Gilgeous-Alexander', 'Ja Morant', 'Donovan Mitchell',
]

export async function loadFeaturedPlayers() {
  const results = []
  for (const name of FEATURED_NAMES) {
    try {
      const res = await fetch(`${SPORTS_DB_BASE}/searchplayers.php?p=${encodeURIComponent(name)}`)
      const data = await res.json()
      if (data.player && data.player.length > 0) {
        const p = data.player[0]
        results.push({
          id: p.idPlayer,
          name: p.strPlayer,
          team: p.strTeam || 'Free Agent',
          position: p.strPosition || 'N/A',
          thumb: p.strThumb || p.strCutout || null,
          nationality: p.strNationality || '',
          birthDate: p.dateBorn || '',
          description: p.strDescriptionEN ? p.strDescriptionEN.slice(0, 200) : '',
          fantasyPts: Math.floor(Math.random() * 25) + 15,
        })
      }
    } catch (err) {
      console.error(`Failed to load ${name}:`, err)
    }
  }
  return results
}