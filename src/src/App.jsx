import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, TABLES } from './supabaseClient'
import { fetchLeagueMeta, loadFeaturedPlayers, searchPlayers } from './nbaApi'

const avatarChoices = ['🏀', '🔥', '⚡', '👑', '🎯', '🚀', '💎', '🛡️']

const initialAuth = { email: '', password: '' }
const initialRoom = { name: '', teamName: '' }

function makeInviteCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

function normalizeUserName(profile, user) {
  return profile?.username?.trim() || user?.email?.split('@')[0] || 'GM'
}

function buildSnakeOrder(members) {
  const sorted = [...members].sort((a, b) => (a.joined_at || '').localeCompare(b.joined_at || ''))
  const ids = sorted.map((member) => member.member_user_id)
  return [...ids, ...[...ids].reverse()]
}

function scoreRoster(picks, playerPool) {
  return picks.reduce((sum, pick) => {
    const player = playerPool.find((item) => item.player_id === pick.player_id)
    return sum + Number(player?.fantasy_points || 0)
  }, 0)
}

function ThreeCourtHero() {
  const orbRef = useRef(null)

  useEffect(() => {
    let raf = 0
    let frame = 0
    const node = orbRef.current
    function animate() {
      try {
        frame += 1
        if (node) {
          node.style.transform = `rotateY(${frame * 0.5}deg) rotateX(${12 + Math.sin(frame * 0.03) * 8}deg)`
        }
      } catch (error) {
        console.error('Hero animation error:', error.message)
      }
      raf = window.requestAnimationFrame(animate)
    }
    animate()
    return () => window.cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="hero-3d-shell" aria-hidden="true">
      <div className="court-glow"></div>
      <div ref={orbRef} className="basketball-orb">
        <span className="orb-line line-a"></span>
        <span className="orb-line line-b"></span>
        <span className="orb-line line-c"></span>
        <span className="orb-line line-d"></span>
      </div>
    </div>
  )
}

export default function App() {
  const [authMode, setAuthMode] = useState('login')
  const [authForm, setAuthForm] = useState(initialAuth)
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [settingsName, setSettingsName] = useState('')
  const [settingsTeam, setSettingsTeam] = useState('')
  const [toast, setToast] = useState('')
  const [roomForm, setRoomForm] = useState(initialRoom)
  const [joinCode, setJoinCode] = useState('')
  const [rooms, setRooms] = useState([])
  const [members, setMembers] = useState([])
  const [picks, setPicks] = useState([])
  const [matchups, setMatchups] = useState([])
  const [players, setPlayers] = useState([])
  const [featuredPlayers, setFeaturedPlayers] = useState([])
  const [activeRoomId, setActiveRoomId] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [leagueMeta, setLeagueMeta] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  function showToast(message) {
    setToast(message)
    window.clearTimeout(showToast.timer)
    showToast.timer = window.setTimeout(() => setToast(''), 2600)
  }

  async function ensureProfile(currentUser) {
    const { data: existing, error: existingError } = await supabase
      .from(TABLES.users)
      .select('*')
      .eq('user_id', currentUser.id)
      .maybeSingle()

    if (existingError) throw existingError
    if (existing) {
      setProfile(existing)
      setSettingsName(existing.username || '')
      setSettingsTeam(existing.favorite_team || '')
      return existing
    }

    const payload = {
      email: currentUser.email,
      username: '',
      avatar_emoji: avatarChoices[Math.floor(Math.random() * avatarChoices.length)],
      favorite_team: ''
    }

    const { data, error } = await supabase.from(TABLES.users).insert(payload).select('*').single()
    if (error) throw error
    setProfile(data)
    return data
  }

  async function seedPlayersIfNeeded() {
    const { data: existing, error: existingError } = await supabase.from(TABLES.players).select('*').limit(30)
    if (existingError) throw existingError
    if (existing && existing.length) {
      setPlayers(existing)
      return existing
    }

    const featured = await loadFeaturedPlayers()
    if (!featured.length) {
      setPlayers([])
      return []
    }

    const { data, error } = await supabase.from(TABLES.players).insert(featured).select('*')
    if (error) throw error
    setPlayers(data || [])
    return data || []
  }

  async function loadAppData(currentUser) {
    const [{ data: roomData, error: roomError }, { data: memberData, error: memberError }, { data: pickData, error: pickError }, { data: matchupData, error: matchupError }] = await Promise.all([
      supabase.from(TABLES.rooms).select('*').order('created_at', { ascending: false }),
      supabase.from(TABLES.members).select('*').order('joined_at', { ascending: true }),
      supabase.from(TABLES.picks).select('*').order('pick_number', { ascending: true }),
      supabase.from(TABLES.matchups).select('*').order('created_at', { ascending: false }),
    ])

    if (roomError) throw roomError
    if (memberError) throw memberError
    if (pickError) throw pickError
    if (matchupError) throw matchupError

    setRooms(roomData || [])
    setMembers(memberData || [])
    setPicks(pickData || [])
    setMatchups(matchupData || [])

    if (!activeRoomId && roomData?.length) {
      const myRoom = roomData.find((room) => room.host_user_id === currentUser.id) || roomData[0]
      setActiveRoomId(myRoom.id)
    }
  }

  async function bootstrap(currentSession) {
    try {
      setLoading(true)
      setSession(currentSession)
      const currentUser = currentSession?.user || null
      setUser(currentUser)
      if (!currentUser) {
        setProfile(null)
        setRooms([])
        setMembers([])
        setPicks([])
        setMatchups([])
        setActiveRoomId(null)
        return
      }
      await ensureProfile(currentUser)
      const [meta, featured] = await Promise.all([fetchLeagueMeta(), seedPlayersIfNeeded()])
      setLeagueMeta(meta)
      setFeaturedPlayers(featured)
      await loadAppData(currentUser)
    } catch (error) {
      console.error('Bootstrap error:', error.message)
      showToast(error.message || 'Could not load the fantasy app.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let mounted = true
    async function init() {
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession()
        if (mounted) await bootstrap(currentSession)
      } catch (error) {
        console.error('Init error:', error.message)
      }
    }
    init()
    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (mounted) await bootstrap(nextSession)
    })
    return () => {
      mounted = false
      listener?.subscription?.unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    async function runSearch() {
      try {
        if (!searchTerm.trim()) {
          setSearchResults([])
          return
        }
        const results = await searchPlayers(searchTerm)
        setSearchResults(results.slice(0, 8))
      } catch (error) {
        console.error('Search error:', error.message)
      }
    }
    const timer = window.setTimeout(runSearch, 350)
    return () => window.clearTimeout(timer)
  }, [searchTerm])

  const activeRoom = useMemo(() => rooms.find((room) => room.id === activeRoomId) || null, [rooms, activeRoomId])
  const activeMembers = useMemo(() => members.filter((member) => member.room_id === activeRoomId), [members, activeRoomId])
  const activePicks = useMemo(() => picks.filter((pick) => pick.room_id === activeRoomId), [picks, activeRoomId])
  const activeMatchups = useMemo(() => matchups.filter((matchup) => matchup.room_id === activeRoomId), [matchups, activeRoomId])

  const leaderboard = useMemo(() => {
    return activeMembers.map((member) => {
      const memberPicks = activePicks.filter((pick) => pick.picked_by_user_id === member.member_user_id)
      const score = scoreRoster(memberPicks, players)
      return {
        ...member,
        score
      }
    }).sort((a, b) => b.score - a.score)
  }, [activeMembers, activePicks, players])

  async function handleAuthSubmit(event) {
    event.preventDefault()
    try {
      setSaving(true)
      if (authMode === 'login') {
        const { error } = await supabase.auth.signInWithPassword(authForm)
        if (error) throw error
        showToast('Welcome back to the draft room.')
      } else {
        const { error } = await supabase.auth.signUp({
          ...authForm,
          options: { emailRedirectTo: 'https://sling-gogiapp.web.app/email-confirmed.html' }
        })
        if (error) throw error
        showToast('Account created. Check your email if confirmation is enabled.')
        setAuthMode('login')
      }
    } catch (error) {
      console.error('Auth error:', error.message)
      showToast(error.message || 'Authentication failed.')
    } finally {
      setSaving(false)
    }
  }

  async function handleLogout() {
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      showToast('Logged out.')
    } catch (error) {
      console.error('Logout error:', error.message)
      showToast('Could not log out.')
    }
  }

  async function saveSettings(event) {
    event.preventDefault()
    try {
      const { data, error } = await supabase
        .from(TABLES.users)
        .update({ username: settingsName.trim(), favorite_team: settingsTeam.trim() })
        .eq('user_id', user.id)
        .select('*')
        .single()
      if (error) throw error
      setProfile(data)
      showToast('Profile updated.')
    } catch (error) {
      console.error('Settings error:', error.message)
      showToast('Could not save your profile.')
    }
  }

  async function createRoom(event) {
    event.preventDefault()
    try {
      if (!roomForm.name.trim()) {
        showToast('Give your draft room a name first.')
        return
      }
      const inviteCode = makeInviteCode()
      const roomPayload = {
        name: roomForm.name.trim(),
        sport: 'NBA',
        host_user_id: user.id,
        invite_code: inviteCode,
        status: 'waiting',
        draft_order: [user.id],
        current_pick_number: 1,
        current_turn_user_id: user.id,
        max_members: 8
      }
      const { data: room, error: roomError } = await supabase.from(TABLES.rooms).insert(roomPayload).select('*').single()
      if (roomError) throw roomError

      const memberPayload = {
        room_id: room.id,
        member_user_id: user.id,
        role: 'host',
        joined_at: new Date().toISOString(),
        team_name: roomForm.teamName.trim() || `${normalizeUserName(profile, user)} All-Stars`,
        draft_position: 1
      }
      const { error: memberError } = await supabase.from(TABLES.members).insert(memberPayload)
      if (memberError) throw memberError

      setRoomForm(initialRoom)
      setActiveRoomId(room.id)
      showToast(`Room created. Invite code: ${inviteCode}`)
      await loadAppData(user)
    } catch (error) {
      console.error('Create room error:', error.message)
      showToast('Could not create the room.')
    }
  }

  async function joinRoom(event) {
    event.preventDefault()
    try {
      const code = joinCode.trim().toUpperCase()
      if (!code) {
        showToast('Enter an invite code.')
        return
      }
      const { data: room, error: roomError } = await supabase.from(TABLES.rooms).select('*').eq('invite_code', code).maybeSingle()
      if (roomError) throw roomError
      if (!room) {
        showToast('No room found for that code.')
        return
      }

      const { data: existing, error: existingError } = await supabase
        .from(TABLES.members)
        .select('*')
        .eq('room_id', room.id)
        .eq('member_user_id', user.id)
        .maybeSingle()
      if (existingError) throw existingError
      if (!existing) {
        const roomMembers = members.filter((member) => member.room_id === room.id)
        const { error: memberError } = await supabase.from(TABLES.members).insert({
          room_id: room.id,
          member_user_id: user.id,
          role: 'member',
          joined_at: new Date().toISOString(),
          team_name: `${normalizeUserName(profile, user)} Squad`,
          draft_position: roomMembers.length + 1
        })
        if (memberError) throw memberError
      }

      const updatedMembers = [...members.filter((member) => member.room_id === room.id), existing].filter(Boolean)
      const order = buildSnakeOrder(updatedMembers.length ? updatedMembers : members.filter((member) => member.room_id === room.id))
      await supabase.from(TABLES.rooms).update({ draft_order: order, current_turn_user_id: order[0] || room.host_user_id }).eq('id', room.id)

      setJoinCode('')
      setActiveRoomId(room.id)
      showToast(`Joined ${room.name}.`)
      await loadAppData(user)
    } catch (error) {
      console.error('Join room error:', error.message)
      showToast('Could not join that room.')
    }
  }

  async function draftPlayer(player) {
    try {
      if (!activeRoom) {
        showToast('Create or join a room first.')
        return
      }
      if (activeRoom.current_turn_user_id !== user.id) {
        showToast('Wait for your turn.')
        return
      }
      const alreadyPicked = activePicks.some((pick) => pick.player_id === player.player_id)
      if (alreadyPicked) {
        showToast('That player is already drafted.')
        return
      }

      const nextPickNumber = (activeRoom.current_pick_number || 1)
      const roundNumber = Math.ceil(nextPickNumber / Math.max(1, activeMembers.length || 1))
      const { error: pickError } = await supabase.from(TABLES.picks).insert({
        room_id: activeRoom.id,
        picked_by_user_id: user.id,
        player_id: player.player_id,
        player_name: player.full_name,
        pick_number: nextPickNumber,
        round_number: roundNumber,
        team: player.team,
        position: player.position
      })
      if (pickError) throw pickError

      const order = Array.isArray(activeRoom.draft_order) && activeRoom.draft_order.length ? activeRoom.draft_order : buildSnakeOrder(activeMembers)
      const currentIndex = order.findIndex((id) => id === user.id)
      const nextTurnUserId = order[(currentIndex + 1) % order.length] || activeRoom.host_user_id
      const nextStatus = nextPickNumber >= Math.max(8, activeMembers.length * 4) ? 'ready' : 'drafting'
      const { error: roomError } = await supabase
        .from(TABLES.rooms)
        .update({
          current_pick_number: nextPickNumber + 1,
          current_turn_user_id: nextTurnUserId,
          status: nextStatus,
          draft_order: order
        })
        .eq('id', activeRoom.id)
      if (roomError) throw roomError

      showToast(`${player.full_name} drafted.`)
      await loadAppData(user)
      if (nextStatus === 'ready') {
        await generateMatchups(activeRoom.id)
      }
    } catch (error) {
      console.error('Draft error:', error.message)
      showToast('Could not draft that player.')
    }
  }

  async function generateMatchups(roomId) {
    try {
      const roomMembers = members.filter((member) => member.room_id === roomId)
      if (roomMembers.length < 2) return
      const pairs = []
      for (let index = 0; index < roomMembers.length; index += 2) {
        const home = roomMembers[index]
        const away = roomMembers[index + 1]
        if (!home || !away) continue
        const homePicks = picks.filter((pick) => pick.room_id === roomId && pick.picked_by_user_id === home.member_user_id)
        const awayPicks = picks.filter((pick) => pick.room_id === roomId && pick.picked_by_user_id === away.member_user_id)
        const homeScore = scoreRoster(homePicks, players)
        const awayScore = scoreRoster(awayPicks, players)
        pairs.push({
          room_id: roomId,
          week_label: 'Week 1',
          home_user_id: home.member_user_id,
          away_user_id: away.member_user_id,
          home_score: homeScore,
          away_score: awayScore,
          winner_user_id: homeScore >= awayScore ? home.member_user_id : away.member_user_id,
          status: 'final'
        })
      }
      if (!pairs.length) return
      await supabase.from(TABLES.matchups).insert(pairs)
      await loadAppData(user)
    } catch (error) {
      console.error('Matchup generation error:', error.message)
    }
  }

  if (loading) {
    return <div className="loading-screen">Loading Dream Team...</div>
  }

  if (!session || !user) {
    return (
      <div className="auth-shell">
        <ThreeCourtHero />
        <section className="auth-card">
          <div className="auth-copy-wrap">
            <p className="eyebrow">NBA fantasy command center</p>
            <h1>Dream Team Draft</h1>
            <p>Create draft rooms, invite your friends, take turns selecting NBA stars, and auto-generate weekly matchups from live player data sources.</p>
          </div>
          <div className="auth-tabs">
            <button className={authMode === 'login' ? 'active' : ''} type="button" onClick={() => setAuthMode('login')}>Log in</button>
            <button className={authMode === 'signup' ? 'active' : ''} type="button" onClick={() => setAuthMode('signup')}>Sign up</button>
          </div>
          <form className="auth-form" onSubmit={handleAuthSubmit}>
            <label>
              <span>Email</span>
              <input type="email" required value={authForm.email} onChange={(event) => setAuthForm((prev) => ({ ...prev, email: event.target.value }))} placeholder="you@example.com" />
            </label>
            <label>
              <span>Password</span>
              <input type="password" required minLength={6} value={authForm.password} onChange={(event) => setAuthForm((prev) => ({ ...prev, password: event.target.value }))} placeholder="Enter password" />
            </label>
            <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Working...' : authMode === 'login' ? 'Log in' : 'Create account'}</button>
          </form>
        </section>
        {toast ? <div className="toast">{toast}</div> : null}
      </div>
    )
  }

  return (
    <div className="app-shell">
      <div className="app-bg-orb orb-one"></div>
      <div className="app-bg-orb orb-two"></div>
      <header className="topbar glass-panel">
        <div>
          <p className="eyebrow">{leagueMeta?.strLeague || 'NBA'} fantasy hub</p>
          <h2>{normalizeUserName(profile, user)}'s command center</h2>
        </div>
        <div className="topbar-actions">
          <button className="ghost-button" type="button" onClick={handleLogout}>Log out</button>
        </div>
      </header>

      <main className="dashboard-grid">
        <section className="hero-panel glass-panel">
          <div>
            <p className="eyebrow">Live draft energy</p>
            <h3>Build an NBA superteam with your friends.</h3>
            <p>Spin up a private room, share the invite code, draft in snake order, and see instant matchup scoring based on the current player pool.</p>
            <div className="hero-chips">
              <span>{rooms.length} rooms</span>
              <span>{players.length} tracked players</span>
              <span>{matchups.length} matchups</span>
            </div>
          </div>
          <ThreeCourtHero />
        </section>

        <section className="panel-column">
          <section className="glass-panel card-section">
            <div className="section-head"><h3>Profile settings</h3></div>
            <form className="settings-form" onSubmit={saveSettings}>
              <label><span>Username</span><input value={settingsName} onChange={(event) => setSettingsName(event.target.value)} placeholder="Your GM name" maxLength={24} /></label>
              <label><span>Favorite team</span><input value={settingsTeam} onChange={(event) => setSettingsTeam(event.target.value)} placeholder="Lakers, Celtics, Knicks..." maxLength={24} /></label>
              <button className="primary-button" type="submit">Save settings</button>
            </form>
          </section>

          <section className="glass-panel card-section">
            <div className="section-head"><h3>Create room</h3></div>
            <form className="settings-form" onSubmit={createRoom}>
              <label><span>Room name</span><input value={roomForm.name} onChange={(event) => setRoomForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="Friday Night Draft" /></label>
              <label><span>Your team name</span><input value={roomForm.teamName} onChange={(event) => setRoomForm((prev) => ({ ...prev, teamName: event.target.value }))} placeholder="Skyhook Syndicate" /></label>
              <button className="primary-button" type="submit">Create NBA room</button>
            </form>
          </section>

          <section className="glass-panel card-section">
            <div className="section-head"><h3>Join room</h3></div>
            <form className="join-form" onSubmit={joinRoom}>
              <input value={joinCode} onChange={(event) => setJoinCode(event.target.value)} placeholder="Enter invite code" maxLength={6} />
              <button className="ghost-button" type="submit">Join</button>
            </form>
          </section>
        </section>

        <section className="main-column">
          <section className="glass-panel card-section">
            <div className="section-head">
              <div>
                <p className="eyebrow">Draft room</p>
                <h3>{activeRoom?.name || 'No room selected'}</h3>
              </div>
              {activeRoom ? <div className="room-meta"><span>Invite: {activeRoom.invite_code}</span><span>Status: {activeRoom.status}</span></div> : null}
            </div>
            {activeRoom ? (
              <div className="draft-room-grid">
                <div className="draft-state-card">
                  <p className="mini-label">Current turn</p>
                  <strong>{activeRoom.current_turn_user_id === user.id ? 'You are on the clock' : 'Waiting for another GM'}</strong>
                  <p className="muted-copy">Pick #{activeRoom.current_pick_number || 1}</p>
                </div>
                <div className="draft-state-card">
                  <p className="mini-label">Members</p>
                  <strong>{activeMembers.length}</strong>
                  <p className="muted-copy">Snake draft enabled</p>
                </div>
                <div className="draft-state-card">
                  <p className="mini-label">Your roster score</p>
                  <strong>{scoreRoster(activePicks.filter((pick) => pick.picked_by_user_id === user.id), players).toFixed(1)}</strong>
                  <p className="muted-copy">Projected points</p>
                </div>
              </div>
            ) : <div className="empty-state">Create or join a room to start drafting.</div>}
          </section>

          <section className="glass-panel card-section">
            <div className="section-head"><h3>Player draft board</h3></div>
            <div className="search-bar"><input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search NBA players" /></div>
            <div className="player-grid">
              {(searchResults.length ? searchResults.map((player) => ({
                player_id: player.idPlayer,
                full_name: player.strPlayer,
                team: player.strTeam || 'NBA',
                position: player.strPosition || 'Flex',
                headshot_url: player.strCutout || player.strThumb || '',
                fantasy_points: 40
              })) : featuredPlayers).map((player) => {
                const drafted = activePicks.some((pick) => pick.player_id === player.player_id)
                return (
                  <article key={player.player_id} className={`player-card ${drafted ? 'drafted' : ''}`}>
                    <div className="player-visual">
                      {player.headshot_url ? <img src={player.headshot_url} alt={player.full_name} /> : <div className="player-fallback">🏀</div>}
                    </div>
                    <div>
                      <strong>{player.full_name}</strong>
                      <p>{player.team} · {player.position}</p>
                      <span>{Number(player.fantasy_points || 0).toFixed(1)} pts</span>
                    </div>
                    <button className="ghost-button" type="button" disabled={drafted || !activeRoom} onClick={() => draftPlayer(player)}>{drafted ? 'Drafted' : 'Draft'}</button>
                  </article>
                )
              })}
            </div>
          </section>
        </section>

        <aside className="side-column">
          <section className="glass-panel card-section">
            <div className="section-head"><h3>Leaderboard</h3></div>
            <div className="leaderboard-list">
              {leaderboard.length ? leaderboard.map((member, index) => (
                <div key={member.id} className="leaderboard-item">
                  <span className="rank-badge">{index + 1}</span>
                  <div>
                    <strong>{member.team_name || 'Untitled Team'}</strong>
                    <p>{member.member_user_id === user.id ? 'You' : 'Friend'} · Draft slot {member.draft_position || '-'}</p>
                  </div>
                  <strong>{member.score.toFixed(1)}</strong>
                </div>
              )) : <div className="empty-state">No leaderboard yet.</div>}
            </div>
          </section>

          <section className="glass-panel card-section">
            <div className="section-head"><h3>Matchups</h3></div>
            <div className="matchup-list">
              {activeMatchups.length ? activeMatchups.map((matchup) => (
                <article key={matchup.id} className="matchup-card">
                  <p className="mini-label">{matchup.week_label}</p>
                  <strong>{matchup.home_score.toFixed(1)} - {matchup.away_score.toFixed(1)}</strong>
                  <p>{matchup.status}</p>
                </article>
              )) : <div className="empty-state">Matchups auto-generate after the draft fills out.</div>}
            </div>
          </section>
        </aside>
      </main>

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}
