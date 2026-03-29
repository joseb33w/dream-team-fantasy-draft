import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, TABLES } from './supabaseClient'
import { fetchLeagueMeta, loadFeaturedPlayers, searchPlayers } from './nbaApi'

const avatarChoices = ['🏀', '🔥', '⚡', '👑', '🎯', '🚀', '💎', '🛡️']
const botNames = ['Pixel Phantoms', 'Neon Ninjas', 'Stat Goblins', 'Backboard Bots', 'Turbo Titans']

const initialAuth = { email: '', password: '' }
const initialRoom = { name: '', teamName: '' }
const initialBotGame = { difficulty: 'medium', humanTeamName: '', botTeamName: '' }

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

function getDifficultyBoost(difficulty) {
  if (difficulty === 'easy') return -8
  if (difficulty === 'hard') return 10
  return 2
}

function createBotSummary(humanScore, botScore, difficulty) {
  if (humanScore > botScore) return `You outscored the ${difficulty} bot with smarter NBA drafting and better weekly upside.`
  if (humanScore < botScore) return `The ${difficulty} bot edged you this round with a tighter projected lineup.`
  return `Dead heat. The ${difficulty} bot matched your roster point for point.`
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
  const [botGameForm, setBotGameForm] = useState(initialBotGame)
  const [rooms, setRooms] = useState([])
  const [members, setMembers] = useState([])
  const [picks, setPicks] = useState([])
  const [matchups, setMatchups] = useState([])
  const [botMatches, setBotMatches] = useState([])
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
    const [roomRes, memberRes, pickRes, matchupRes, botRes] = await Promise.all([
      supabase.from(TABLES.rooms).select('*').order('created_at', { ascending: false }),
      supabase.from(TABLES.members).select('*').order('joined_at', { ascending: true }),
      supabase.from(TABLES.picks).select('*').order('pick_number', { ascending: true }),
      supabase.from(TABLES.matchups).select('*').order('created_at', { ascending: false }),
      supabase.from(TABLES.botMatches).select('*').eq('owner_user_id', currentUser.id).order('created_at', { ascending: false })
    ])

    if (roomRes.error) throw roomRes.error
    if (memberRes.error) throw memberRes.error
    if (pickRes.error) throw pickRes.error
    if (matchupRes.error) throw matchupRes.error
    if (botRes.error) throw botRes.error

    const roomData = roomRes.data || []
    setRooms(roomData)
    setMembers(memberRes.data || [])
    setPicks(pickRes.data || [])
    setMatchups(matchupRes.data || [])
    setBotMatches(botRes.data || [])

    if (!activeRoomId && roomData.length) {
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
        setBotMatches([])
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

  const botLeaderboard = useMemo(() => {
    return botMatches.map((match) => ({
      ...match,
      margin: Number(match.human_score || 0) - Number(match.bot_score || 0)
    }))
  }, [botMatches])

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
        showToast('No room found for that invite code.')
        return
      }

      const { data: existingMember, error: existingError } = await supabase
        .from(TABLES.members)
        .select('*')
        .eq('room_id', room.id)
        .eq('member_user_id', user.id)
        .maybeSingle()
      if (existingError) throw existingError

      if (!existingMember) {
        const roomMembers = members.filter((member) => member.room_id === room.id)
        const { error: joinError } = await supabase.from(TABLES.members).insert({
          room_id: room.id,
          member_user_id: user.id,
          role: 'player',
          joined_at: new Date().toISOString(),
          team_name: `${normalizeUserName(profile, user)} Squad`,
          draft_position: roomMembers.length + 1
        })
        if (joinError) throw joinError
      }

      setJoinCode('')
      setActiveRoomId(room.id)
      showToast(`Joined ${room.name}.`)
      await loadAppData(user)
    } catch (error) {
      console.error('Join room error:', error.message)
      showToast('Could not join that room.')
    }
  }

  async function startDraft() {
    try {
      if (!activeRoom) {
        showToast('Select a room first.')
        return
      }
      if (activeMembers.length < 2) {
        showToast('You need at least two managers to start.')
        return
      }
      const snakeOrder = buildSnakeOrder(activeMembers)
      const { error } = await supabase
        .from(TABLES.rooms)
        .update({
          status: 'live',
          draft_order: snakeOrder,
          current_pick_number: 1,
          current_turn_user_id: snakeOrder[0]
        })
        .eq('id', activeRoom.id)
      if (error) throw error
      showToast('Draft is live.')
      await loadAppData(user)
    } catch (error) {
      console.error('Start draft error:', error.message)
      showToast('Could not start the draft.')
    }
  }

  async function draftPlayer(player) {
    try {
      if (!activeRoom) {
        showToast('Choose a room first.')
        return
      }
      if (activeRoom.status !== 'live') {
        showToast('Start the draft first.')
        return
      }
      if (activeRoom.current_turn_user_id !== user.id) {
        showToast('It is not your turn yet.')
        return
      }
      const alreadyDrafted = activePicks.some((pick) => pick.player_id === player.player_id)
      if (alreadyDrafted) {
        showToast('That player has already been drafted.')
        return
      }

      const nextPickNumber = Number(activeRoom.current_pick_number || 1)
      const { error: pickError } = await supabase.from(TABLES.picks).insert({
        room_id: activeRoom.id,
        player_id: player.player_id,
        picked_by_user_id: user.id,
        pick_number: nextPickNumber,
        round_number: Math.ceil(nextPickNumber / Math.max(activeMembers.length, 1)),
        team_name: activeMembers.find((member) => member.member_user_id === user.id)?.team_name || `${normalizeUserName(profile, user)} Team`
      })
      if (pickError) throw pickError

      const order = Array.isArray(activeRoom.draft_order) ? activeRoom.draft_order : []
      const nextIndex = nextPickNumber % Math.max(order.length, 1)
      const nextTurnUserId = order[nextIndex] || null
      const totalSlots = activeMembers.length * 5
      const shouldComplete = nextPickNumber >= totalSlots

      const roomUpdate = {
        current_pick_number: nextPickNumber + 1,
        current_turn_user_id: shouldComplete ? null : nextTurnUserId,
        status: shouldComplete ? 'complete' : 'live'
      }

      const { error: roomError } = await supabase.from(TABLES.rooms).update(roomUpdate).eq('id', activeRoom.id)
      if (roomError) throw roomError

      if (shouldComplete) {
        const latestPicks = [...activePicks, {
          room_id: activeRoom.id,
          player_id: player.player_id,
          picked_by_user_id: user.id,
          pick_number: nextPickNumber
        }]
        const scoredMembers = activeMembers.map((member) => {
          const memberPicks = latestPicks.filter((pick) => pick.picked_by_user_id === member.member_user_id)
          return {
            member,
            score: scoreRoster(memberPicks, players)
          }
        }).sort((a, b) => b.score - a.score)

        if (scoredMembers.length >= 2) {
          const { error: matchupError } = await supabase.from(TABLES.matchups).insert({
            room_id: activeRoom.id,
            home_user_id: scoredMembers[0].member.member_user_id,
            away_user_id: scoredMembers[1].member.member_user_id,
            home_score: scoredMembers[0].score,
            away_score: scoredMembers[1].score,
            winner_user_id: scoredMembers[0].score >= scoredMembers[1].score ? scoredMembers[0].member.member_user_id : scoredMembers[1].member.member_user_id,
            week_label: 'Auto Matchup'
          })
          if (matchupError) throw matchupError
        }
      }

      showToast(`${player.full_name} drafted.`)
      await loadAppData(user)
    } catch (error) {
      console.error('Draft player error:', error.message)
      showToast('Could not draft that player.')
    }
  }

  async function createBotMatch(event) {
    event.preventDefault()
    try {
      if (!user) return
      const difficulty = botGameForm.difficulty
      const humanTeamName = botGameForm.humanTeamName.trim() || `${normalizeUserName(profile, user)} Solo Squad`
      const botTeamName = botGameForm.botTeamName.trim() || botNames[Math.floor(Math.random() * botNames.length)]
      const soloRoomName = `${humanTeamName} vs ${botTeamName}`
      const inviteCode = makeInviteCode()

      const { data: room, error: roomError } = await supabase.from(TABLES.rooms).insert({
        name: soloRoomName,
        sport: 'NBA',
        host_user_id: user.id,
        invite_code: inviteCode,
        status: 'solo',
        draft_order: [user.id],
        current_pick_number: 1,
        current_turn_user_id: user.id,
        max_members: 1
      }).select('*').single()
      if (roomError) throw roomError

      const { error: memberError } = await supabase.from(TABLES.members).insert({
        room_id: room.id,
        member_user_id: user.id,
        role: 'host',
        joined_at: new Date().toISOString(),
        team_name: humanTeamName,
        draft_position: 1
      })
      if (memberError) throw memberError

      const pool = [...players].sort((a, b) => Number(b.fantasy_points || 0) - Number(a.fantasy_points || 0)).slice(0, 8)
      const humanRoster = pool.filter((_, index) => index % 2 === 0)
      const botRoster = pool.filter((_, index) => index % 2 === 1)
      const humanScore = scoreRoster(humanRoster.map((player) => ({ player_id: player.player_id })), players)
      const botBase = scoreRoster(botRoster.map((player) => ({ player_id: player.player_id })), players)
      const botScore = Math.max(0, botBase + getDifficultyBoost(difficulty))
      const winner = humanScore >= botScore ? 'human' : 'bot'
      const summary = createBotSummary(humanScore, botScore, difficulty)

      const { error: botError } = await supabase.from(TABLES.botMatches).insert({
        room_id: room.id,
        owner_user_id: user.id,
        difficulty,
        status: 'complete',
        bot_team_name: botTeamName,
        human_team_name: humanTeamName,
        human_score: humanScore,
        bot_score: botScore,
        winner,
        summary,
        completed_at: new Date().toISOString()
      })
      if (botError) throw botError

      setBotGameForm(initialBotGame)
      setActiveRoomId(room.id)
      showToast(`Solo showdown complete: ${winner === 'human' ? 'you won' : `${botTeamName} won`}.`)
      await loadAppData(user)
    } catch (error) {
      console.error('Create bot match error:', error.message)
      showToast('Could not start a computer matchup.')
    }
  }

  if (loading) {
    return <div className="loading-screen">Loading dream team...</div>
  }

  if (!session || !user) {
    return (
      <div className="auth-shell">
        <div className="app-bg-orb orb-one"></div>
        <div className="app-bg-orb orb-two"></div>
        <div className="auth-card">
          <div className="auth-copy-wrap">
            <p className="eyebrow">NBA fantasy draft room</p>
            <h1>Dream Team</h1>
            <p>Create draft rooms, invite friends, draft NBA stars, and now run solo battles against the computer.</p>
          </div>

          <div className="auth-tabs">
            <button className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')} type="button">Log in</button>
            <button className={authMode === 'signup' ? 'active' : ''} onClick={() => setAuthMode('signup')} type="button">Sign up</button>
          </div>

          <form className="auth-form" onSubmit={handleAuthSubmit}>
            <label>
              <span>Email</span>
              <input type="email" value={authForm.email} onChange={(event) => setAuthForm((prev) => ({ ...prev, email: event.target.value }))} placeholder="you@example.com" required />
            </label>
            <label>
              <span>Password</span>
              <input type="password" value={authForm.password} onChange={(event) => setAuthForm((prev) => ({ ...prev, password: event.target.value }))} placeholder="Enter password" minLength={6} required />
            </label>
            <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Working...' : authMode === 'login' ? 'Log in' : 'Create account'}</button>
          </form>
        </div>
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
          <p className="eyebrow">NBA fantasy control room</p>
          <h2>{profile?.username?.trim() || normalizeUserName(profile, user)}</h2>
          <div className="hero-chips">
            <span>{leagueMeta?.strLeague || 'NBA'} live draft</span>
            <span>{rooms.length} rooms</span>
            <span>{botMatches.length} bot battles</span>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="ghost-button" type="button" onClick={handleLogout}>Log out</button>
        </div>
      </header>

      <main className="dashboard-grid">
        <section className="hero-panel glass-panel">
          <div>
            <p className="eyebrow">Commissioner dashboard</p>
            <h3>Draft with friends or run a solo showdown against the computer.</h3>
            <p>Spin up NBA draft rooms, invite your league, search real players, and use the new bot arena when you want a quick fantasy matchup without waiting on anyone else.</p>
            <div className="hero-chips">
              <span>Auth enabled</span>
              <span>Invite codes</span>
              <span>Bot mode ready</span>
            </div>
          </div>
          <ThreeCourtHero />
        </section>

        <aside className="panel-column">
          <section className="card-section glass-panel">
            <div className="section-head">
              <div>
                <p className="eyebrow">Profile</p>
                <h3>Settings</h3>
              </div>
            </div>
            <form className="settings-form" onSubmit={saveSettings}>
              <label>
                <span>Username</span>
                <input value={settingsName} onChange={(event) => setSettingsName(event.target.value)} placeholder="Pick a GM name" maxLength={24} />
              </label>
              <label>
                <span>Favorite team</span>
                <input value={settingsTeam} onChange={(event) => setSettingsTeam(event.target.value)} placeholder="Lakers, Knicks, Celtics..." maxLength={32} />
              </label>
              <button className="primary-button" type="submit">Save profile</button>
            </form>
          </section>

          <section className="card-section glass-panel">
            <div className="section-head">
              <div>
                <p className="eyebrow">Create room</p>
                <h3>New draft room</h3>
              </div>
            </div>
            <form className="room-form" onSubmit={createRoom}>
              <label>
                <span>Room name</span>
                <input value={roomForm.name} onChange={(event) => setRoomForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="Friday Night Draft" required />
              </label>
              <label>
                <span>Your team name</span>
                <input value={roomForm.teamName} onChange={(event) => setRoomForm((prev) => ({ ...prev, teamName: event.target.value }))} placeholder="Skyhook Syndicate" />
              </label>
              <button className="primary-button" type="submit">Create room</button>
            </form>
          </section>

          <section className="card-section glass-panel">
            <div className="section-head">
              <div>
                <p className="eyebrow">Join room</p>
                <h3>Use invite code</h3>
              </div>
            </div>
            <form className="join-form" onSubmit={joinRoom}>
              <input value={joinCode} onChange={(event) => setJoinCode(event.target.value)} placeholder="Enter invite code" maxLength={8} />
              <button className="ghost-button" type="submit">Join draft</button>
            </form>
          </section>
        </aside>

        <section className="main-column">
          <section className="card-section glass-panel">
            <div className="section-head">
              <div>
                <p className="eyebrow">Draft board</p>
                <h3>{activeRoom?.name || 'Choose a room'}</h3>
              </div>
              <div className="inline-actions">
                {activeRoom ? <span className="mini-label">Status: {activeRoom.status}</span> : null}
                {activeRoom?.invite_code ? <span className="mini-label">Invite: {activeRoom.invite_code}</span> : null}
                {activeRoom?.status === 'waiting' ? <button className="primary-button" type="button" onClick={startDraft}>Start draft</button> : null}
              </div>
            </div>

            {rooms.length ? (
              <div className="room-list">
                {rooms.map((room) => (
                  <button key={room.id} type="button" className="room-tile" onClick={() => setActiveRoomId(room.id)}>
                    <strong>{room.name}</strong>
                    <p>{room.status} · {room.invite_code}</p>
                  </button>
                ))}
              </div>
            ) : <div className="empty-state">No rooms yet. Create one on the left.</div>}

            <div className="draft-room-grid" style={{ marginTop: 16 }}>
              <div className="draft-state-card">
                <span className="mini-label">Turn</span>
                <p className="muted-copy">{activeRoom?.current_turn_user_id === user.id ? 'Your pick' : activeRoom?.current_turn_user_id ? 'Another manager is up' : 'Waiting to start'}</p>
              </div>
              <div className="draft-state-card">
                <span className="mini-label">Pick #</span>
                <p className="muted-copy">{activeRoom?.current_pick_number || 1}</p>
              </div>
              <div className="draft-state-card">
                <span className="mini-label">Managers</span>
                <p className="muted-copy">{activeMembers.length}</p>
              </div>
            </div>
          </section>

          <section className="card-section glass-panel">
            <div className="section-head">
              <div>
                <p className="eyebrow">Player pool</p>
                <h3>Search and draft NBA players</h3>
              </div>
            </div>
            <div className="search-bar">
              <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search NBA players" />
            </div>
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
                      <p>Projected fantasy score: {Number(player.fantasy_points || 0).toFixed(1)}</p>
                    </div>
                    <button className="ghost-button" type="button" disabled={drafted} onClick={() => draftPlayer(player)}>
                      {drafted ? 'Drafted' : 'Draft player'}
                    </button>
                  </article>
                )
              })}
            </div>
          </section>
        </section>

        <aside className="side-column">
          <section className="card-section glass-panel">
            <div className="section-head">
              <div>
                <p className="eyebrow">Leaderboard</p>
                <h3>Room standings</h3>
              </div>
            </div>
            <div className="leaderboard-list">
              {leaderboard.length ? leaderboard.map((member, index) => (
                <article key={`${member.room_id}-${member.member_user_id}`} className="leaderboard-item">
                  <div className="rank-badge">{index + 1}</div>
                  <div>
                    <strong>{member.team_name}</strong>
                    <p>{member.role}</p>
                  </div>
                  <strong>{member.score.toFixed(1)}</strong>
                </article>
              )) : <div className="empty-state">Draft a room to see standings.</div>}
            </div>
          </section>

          <section className="card-section glass-panel">
            <div className="section-head">
              <div>
                <p className="eyebrow">Play vs computer</p>
                <h3>Solo bot arena</h3>
              </div>
            </div>
            <form className="bot-form" onSubmit={createBotMatch}>
              <label>
                <span>Difficulty</span>
                <select value={botGameForm.difficulty} onChange={(event) => setBotGameForm((prev) => ({ ...prev, difficulty: event.target.value }))}>
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </label>
              <label>
                <span>Your solo team name</span>
                <input value={botGameForm.humanTeamName} onChange={(event) => setBotGameForm((prev) => ({ ...prev, humanTeamName: event.target.value }))} placeholder="Midrange Machines" />
              </label>
              <label>
                <span>Bot team name</span>
                <input value={botGameForm.botTeamName} onChange={(event) => setBotGameForm((prev) => ({ ...prev, botTeamName: event.target.value }))} placeholder="Leave blank for random" />
              </label>
              <button className="primary-button" type="submit">Run bot matchup</button>
            </form>
          </section>

          <section className="card-section glass-panel">
            <div className="section-head">
              <div>
                <p className="eyebrow">Solo results</p>
                <h3>Bot battle history</h3>
              </div>
            </div>
            <div className="bot-match-list">
              {botLeaderboard.length ? botLeaderboard.map((match) => (
                <article key={match.id} className="bot-match-card">
                  <div className="inline-actions">
                    <span className="bot-badge">{match.difficulty}</span>
                    <span className="bot-badge">{match.winner === 'human' ? 'You won' : 'Bot won'}</span>
                  </div>
                  <p><strong>{match.human_team_name}</strong> vs <strong>{match.bot_team_name}</strong></p>
                  <div className="bot-score-grid">
                    <div className="stat-box">
                      <span>Your score</span>
                      <strong>{Number(match.human_score || 0).toFixed(1)}</strong>
                    </div>
                    <div className="stat-box">
                      <span>Bot score</span>
                      <strong>{Number(match.bot_score || 0).toFixed(1)}</strong>
                    </div>
                  </div>
                  <p>{match.summary}</p>
                </article>
              )) : <div className="empty-state">No computer matchups yet. Start one above.</div>}
            </div>
          </section>

          <section className="card-section glass-panel">
            <div className="section-head">
              <div>
                <p className="eyebrow">Auto matchups</p>
                <h3>Generated results</h3>
              </div>
            </div>
            <div className="matchup-list">
              {activeMatchups.length ? activeMatchups.map((matchup) => (
                <article key={matchup.id} className="matchup-card">
                  <strong>{matchup.week_label || 'Matchup'}</strong>
                  <p>{Number(matchup.home_score || 0).toFixed(1)} - {Number(matchup.away_score || 0).toFixed(1)}</p>
                </article>
              )) : <div className="empty-state">Finish a draft to auto-generate a matchup.</div>}
            </div>
          </section>
        </aside>
      </main>

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}
