const BASE = 'https://www.thesportsdb.com/api/v1/json/3';
const LEAGUE_ID = 4387;

export async function fetchLeagueMeta() {
  const r = await fetch(`${BASE}/lookupleague.php?id=${LEAGUE_ID}`);
  const j = await r.json();
  return j.leagues?.[0] || null;
}

export async function searchPlayers(term) {
  if (!term || term.length < 2) return [];
  const r = await fetch(`${BASE}/searchplayers.php?t=&p=${encodeURIComponent(term)}`);
  const j = await r.json();
  if (!j.player) return [];
  return j.player
    .filter(p => p.strSport === 'Basketball')
    .map(p => ({
      id: p.idPlayer,
      name: p.strPlayer,
      team: p.strTeam || 'Free Agent',
      pos: p.strPosition || 'N/A',
      thumb: p.strThumb || p.strCutout || null,
      nation: p.strNationality || '',
      desc: p.strDescriptionEN?.slice(0, 120) || ''
    }));
}

export async function loadFeaturedPlayers() {
  const names = [
    'LeBron James','Stephen Curry','Kevin Durant','Giannis Antetokounmpo',
    'Luka Doncic','Nikola Jokic','Joel Embiid','Jayson Tatum',
    'Anthony Edwards','Shai Gilgeous-Alexander','Ja Morant','Donovan Mitchell'
  ];
  const all = await Promise.allSettled(names.map(n => searchPlayers(n)));
  const out = [];
  all.forEach(r => {
    if (r.status === 'fulfilled' && r.value.length) out.push(r.value[0]);
  });
  return out;
}
