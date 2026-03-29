import React, { useState, useEffect, useRef, useCallback } from 'react'
import { supabase, TABLES } from './supabaseClient'
import { searchPlayers, loadFeaturedPlayers } from './nbaApi'

/* ───── tiny helpers ───── */
const gen = (n = 8) => Array.from(crypto.getRandomValues(new Uint8Array(n))).map(b => b.toString(36).padStart(2, '0')).join('').slice(0, n)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C']
const PICK_TIME = 30
const MAX_ROSTER = 8

/* ───── Toast system ───── */
function ToastContainer({ toasts }) {
  return (
    <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>{t.msg}</div>
      ))}
    </div>
  )
}

/* ───── Three-style court hero (CSS only) ───── */
function ThreeCourtHero() {
  return (
    <div style={{ position: 'relative', width: '100%', height: 200, overflow: 'hidden', borderRadius: 16, marginBottom: 24, background: 'radial-gradient(ellipse at center, #1e3a5f 0%, #0a0a1a 100%)' }}>
      <div style={{ position: 'absolute', top: '50%', left: '50%', width: 100, height: 100, borderRadius: '50%', transform: 'translate(-50%, -50%)', background: 'radial-gradient(circle, rgba(0,212,255,0.4) 0%, transparent 70%)', animation: 'pulse 2s ease-in-out infinite' }} />
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: 48 }}>🏀</div>
      <div style={{ position: 'absolute', bottom: 16, width: '100%', textAlign: 'center', fontFamily: 'Orbitron', fontSize: 14, color: 'rgba(255,255,255,0.5)', letterSpacing: 4 }}>DREAM TEAM</div>
    </div>
  )
}

/* ═══════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════ */
export default function App() {
  // Auth
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authView, setAuthView] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [authError, setAuthError] = useState('')

  // Navigation & global
  const [view, setView] = useState('dashboard')
  const [toasts, setToasts] = useState([])

  // Rooms
  const [rooms, setRooms] = useState([])
  const [currentRoom, setCurrentRoom] = useState(null)
  const [roomMembers, setRoomMembers] = useState([])
  const [joinCode, setJoinCode] = useState('')
  const [newRoomName, setNewRoomName] = useState('')
  const [newRoomSlots, setNewRoomSlots] = useState(4)

  // Draft
  const [draftState, setDraftState] = useState('waiting') // waiting | active | complete
  const [draftOrder, setDraftOrder] = useState([])
  const [currentPickIdx, setCurrentPickIdx] = useState(0)
  const [picks, setPicks] = useState([])
  const [timer, setTimer] = useState(PICK_TIME)
  const [availablePlayers, setAvailablePlayers] = useState([])
  const [playerSearch, setPlayerSearch] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [myRoster, setMyRoster] = useState([])
  const [matchups, setMatchups] = useState([])
  const timerRef = useRef(null)

  // Profile & leaderboard
  const [profile, setProfile] = useState(null)
  const [leaderboard, setLeaderboard] = useState([])
  const [profileLoading, setProfileLoading] = useState(false)

  // Bot Arena
  const [botDraft, setBotDraft] = useState(null)
  const [botPlayers, setBotPlayers] = useState([])
  const [botMyRoster, setBotMyRoster] = useState([])
  const [botCpuRoster, setBotCpuRoster] = useState([])
  const [botPickIdx, setBotPickIdx] = useState(0)
  const [botTimer, setBotTimer] = useState(PICK_TIME)
  const [botState, setBotState] = useState('idle') // idle | drafting | complete
  const [botSearch, setBotSearch] = useState('')
  const [botSearchResults, setBotSearchResults] = useState([])
  const [botSearching, setBotSearching] = useState(false)
  const botTimerRef = useRef(null)
  const [featuredPlayers, setFeaturedPlayers] = useState([])
  const [featuredLoading, setFeaturedLoading] = useState(false)

  const toast = useCallback((msg, type = 'info') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, msg, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000)
  }, [])

  /* ── Auth ── */
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      setUser(u)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleAuth() {
    setAuthError('')
    if (authView === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setAuthError(error.message)
      else toast('Welcome back! 🏀', 'success')
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: 'https://sling-gogiapp.web.app/email-confirmed.html' }
      })
      if (error) setAuthError(error.message)
      else {
        // Save display name
        if (data.user) {
          await supabase.from(TABLES.users).upsert({ user_id: data.user.id, email, display_name: displayName || email.split('@')[0] })
        }
        toast('Account created! Check email to confirm.', 'success')
      }
    }
  }

  async function logout() {
    await supabase.auth.signOut()
    setUser(null)
    setView('dashboard')
    setCurrentRoom(null)
    toast('Signed out', 'info')
  }

  /* ── Load rooms ── */
  async function loadRooms() {
    if (!user) return
    const { data: memberRows } = await supabase.from(TABLES.members).select('room_id').eq('user_id', user.id)
    if (!memberRows || memberRows.length === 0) { setRooms([]); return }
    const roomIds = memberRows.map(r => r.room_id)
    const { data: roomRows } = await supabase.from(TABLES.rooms).select('*').in('id', roomIds).order('created_at', { ascending: false })
    setRooms(roomRows || [])
  }

  useEffect(() => { if (user) loadRooms() }, [user])

  /* ── Create room ── */
  async function createRoom() {
    if (!newRoomName.trim()) return toast('Enter a room name', 'error')
    const code = gen(6).toUpperCase()
    const { data: room, error } = await supabase.from(TABLES.rooms).insert({
      user_id: user.id,
      name: newRoomName.trim(),
      code,
      max_slots: newRoomSlots,
      status: 'waiting'
    }).select().single()
    if (error) return toast('Failed to create room', 'error')
    await supabase.from(TABLES.members).insert({ user_id: user.id, room_id: room.id, display_name: displayName || email.split('@')[0] })
    toast(`Room created! Code: ${code}`, 'success')
    setNewRoomName('')
    loadRooms()
  }

  /* ── Join room ── */
  async function joinRoom() {
    if (!joinCode.trim()) return toast('Enter a room code', 'error')
    const { data: room } = await supabase.from(TABLES.rooms).select('*').eq('code', joinCode.trim().toUpperCase()).single()
    if (!room) return toast('Room not found', 'error')
    const { data: existing } = await supabase.from(TABLES.members).select('id').eq('room_id', room.id).eq('user_id', user.id).single()
    if (!existing) {
      const { data: allMembers } = await supabase.from(TABLES.members).select('id').eq('room_id', room.id)
      if (allMembers && allMembers.length >= room.max_slots) return toast('Room is full', 'error')
      await supabase.from(TABLES.members).insert({ user_id: user.id, room_id: room.id, display_name: displayName || email.split('@')[0] })
    }
    toast(`Joined ${room.name}!`, 'success')
    setJoinCode('')
    loadRooms()
  }

  /* ── Enter room ── */
  async function enterRoom(room) {
    setCurrentRoom(room)
    setView('room')
    const { data: members } = await supabase.from(TABLES.members).select('*').eq('room_id', room.id)
    setRoomMembers(members || [])
    const { data: pickRows } = await supabase.from(TABLES.picks).select('*').eq('room_id', room.id).order('pick_number')
    setPicks(pickRows || [])
    if (room.status === 'drafting') {
      setDraftState('active')
      rebuildDraftOrder(members || [], room)
      setCurrentPickIdx(pickRows ? pickRows.length : 0)
      startDraftTimer()
      await loadAvailablePlayers(pickRows || [])
    } else if (room.status === 'complete') {
      setDraftState('complete')
      loadMatchups(room.id)
    } else {
      setDraftState('waiting')
    }
    buildMyRoster(pickRows || [])
  }

  function rebuildDraftOrder(members, room) {
    const mIds = members.map(m => m.user_id)
    const totalPicks = MAX_ROSTER * mIds.length
    const order = []
    for (let round = 0; round < MAX_ROSTER; round++) {
      const arr = round % 2 === 0 ? [...mIds] : [...mIds].reverse()
      order.push(...arr)
    }
    setDraftOrder(order.slice(0, totalPicks))
  }

  function buildMyRoster(pickRows) {
    if (!user) return
    setMyRoster(pickRows.filter(p => p.user_id === user.id))
  }

  /* ── Start draft ── */
  async function startDraft() {
    if (!currentRoom) return
    await supabase.from(TABLES.rooms).update({ status: 'drafting' }).eq('id', currentRoom.id)
    setCurrentRoom({ ...currentRoom, status: 'drafting' })
    setDraftState('active')
    rebuildDraftOrder(roomMembers, currentRoom)
    setCurrentPickIdx(0)
    setPicks([])
    setMyRoster([])
    startDraftTimer()
    await loadAvailablePlayers([])
    toast('Draft started! 🎉', 'success')
  }

  async function loadAvailablePlayers(existingPicks) {
    const featured = await loadFeaturedPlayers()
    const pickedIds = new Set(existingPicks.map(p => p.player_id))
    setAvailablePlayers(featured.filter(p => !pickedIds.has(p.id)))
  }

  function startDraftTimer() {
    setTimer(PICK_TIME)
    clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setTimer(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current)
          autoPick()
          return PICK_TIME
        }
        return prev - 1
      })
    }, 1000)
  }

  async function autoPick() {
    if (availablePlayers.length > 0) {
      const randomPlayer = availablePlayers[Math.floor(Math.random() * availablePlayers.length)]
      await makePick(randomPlayer)
    }
  }

  async function makePick(player) {
    if (!currentRoom || !user) return
    if (draftOrder[currentPickIdx] !== user.id) return toast('Not your turn!', 'error')
    const pick = {
      room_id: currentRoom.id,
      user_id: user.id,
      player_id: player.id,
      player_name: player.name,
      player_team: player.team,
      player_position: player.position,
      player_thumb: player.thumb || '',
      fantasy_pts: player.fantasyPts || 0,
      pick_number: currentPickIdx + 1
    }
    const { error } = await supabase.from(TABLES.picks).insert(pick)
    if (error) return toast('Failed to pick', 'error')
    const newPicks = [...picks, pick]
    setPicks(newPicks)
    buildMyRoster(newPicks)
    setAvailablePlayers(prev => prev.filter(p => p.id !== player.id))
    toast(`Drafted ${player.name}! 🔥`, 'success')

    const nextIdx = currentPickIdx + 1
    if (nextIdx >= draftOrder.length) {
      completeDraft()
    } else {
      setCurrentPickIdx(nextIdx)
      clearInterval(timerRef.current)
      startDraftTimer()
    }
  }

  async function completeDraft() {
    clearInterval(timerRef.current)
    setDraftState('complete')
    await supabase.from(TABLES.rooms).update({ status: 'complete' }).eq('id', currentRoom.id)
    setCurrentRoom({ ...currentRoom, status: 'complete' })
    await generateMatchups()
    toast('Draft complete! Matchups generated! 🏆', 'success')
  }

  async function generateMatchups() {
    const memberIds = roomMembers.map(m => m.user_id)
    const newMatchups = []
    for (let i = 0; i < memberIds.length; i++) {
      for (let j = i + 1; j < memberIds.length; j++) {
        newMatchups.push({
          room_id: currentRoom.id,
          user_a: memberIds[i],
          user_b: memberIds[j],
          score_a: Math.floor(Math.random() * 150) + 80,
          score_b: Math.floor(Math.random() * 150) + 80,
        })
      }
    }
    if (newMatchups.length > 0) {
      await supabase.from(TABLES.matchups).insert(newMatchups)
    }
    setMatchups(newMatchups)
  }

  async function loadMatchups(roomId) {
    const { data } = await supabase.from(TABLES.matchups).select('*').eq('room_id', roomId)
    setMatchups(data || [])
  }

  /* ── Player search ── */
  useEffect(() => {
    if (!playerSearch || playerSearch.length < 2) { setSearchResults([]); return }
    setSearching(true)
    const timeout = setTimeout(async () => {
      const results = await searchPlayers(playerSearch)
      const pickedIds = new Set(picks.map(p => p.player_id))
      setSearchResults(results.filter(p => !pickedIds.has(p.id)))
      setSearching(false)
    }, 400)
    return () => clearTimeout(timeout)
  }, [playerSearch, picks])

  /* ── Profile ── */
  async function loadProfile() {
    setProfileLoading(true)
    const { data } = await supabase.from(TABLES.users).select('*').eq('user_id', user.id).single()
    setProfile(data)
    setProfileLoading(false)
  }

  async function loadLeaderboard() {
    const { data } = await supabase.from(TABLES.users).select('*').order('created_at', { ascending: true }).limit(20)
    setLeaderboard(data || [])
  }

  /* ── Bot Arena ── */
  async function startBotDraft() {
    setFeaturedLoading(true)
    const players = await loadFeaturedPlayers()
    setFeaturedLoading(false)
    if (players.length < 8) return toast('Could not load enough players', 'error')
    setBotPlayers(players)
    setBotMyRoster([])
    setBotCpuRoster([])
    setBotPickIdx(0)
    setBotState('drafting')
    setBotTimer(PICK_TIME)
    startBotTimer()
    toast('Bot Draft started! You pick first.', 'success')
  }

  function startBotTimer() {
    setBotTimer(PICK_TIME)
    clearInterval(botTimerRef.current)
    botTimerRef.current = setInterval(() => {
      setBotTimer(prev => {
        if (prev <= 1) {
          clearInterval(botTimerRef.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  function botMakePick(player) {
    if (botState !== 'drafting') return
    const isMyTurn = botPickIdx % 2 === 0
    if (!isMyTurn) return toast('CPU is picking...', 'error')
    setBotMyRoster(prev => [...prev, player])
    setBotPlayers(prev => prev.filter(p => p.id !== player.id))
    toast(`You drafted ${player.name}! 🔥`, 'success')
    const nextIdx = botPickIdx + 1
    setBotPickIdx(nextIdx)
    if (nextIdx >= 8) {
      finishBotDraft()
    } else {
      // CPU turn
      clearInterval(botTimerRef.current)
      setTimeout(() => cpuPick(nextIdx), 1000)
    }
  }

  function cpuPick(idx) {
    setBotPlayers(prev => {
      if (prev.length === 0) return prev
      const best = [...prev].sort((a, b) => b.fantasyPts - a.fantasyPts)[0]
      setBotCpuRoster(r => [...r, best])
      toast(`CPU drafted ${best.name} 🤖`, 'info')
      const nextIdx = idx + 1
      setBotPickIdx(nextIdx)
      if (nextIdx >= 8) {
        finishBotDraft()
        return prev.filter(p => p.id !== best.id)
      }
      startBotTimer()
      return prev.filter(p => p.id !== best.id)
    })
  }

  function finishBotDraft() {
    clearInterval(botTimerRef.current)
    setBotState('complete')
    toast('Bot draft complete! 🏆', 'success')
  }

  /* ── Bot search ── */
  useEffect(() => {
    if (!botSearch || botSearch.length < 2) { setBotSearchResults([]); return }
    setBotSearching(true)
    const timeout = setTimeout(async () => {
      const results = await searchPlayers(botSearch)
      setBotSearchResults(results)
      setBotSearching(false)
    }, 400)
    return () => clearTimeout(timeout)
  }, [botSearch])

  /* ── Cleanup timers ── */
  useEffect(() => {
    return () => {
      clearInterval(timerRef.current)
      clearInterval(botTimerRef.current)
    }
  }, [])

  /* ═══════════════════════════════════════
     RENDER
     ═══════════════════════════════════════ */
  if (authLoading) {
    return <div className="app-loading"><div className="loading-orb" /><p>Loading Dream Team...</p></div>
  }

  /* ── Auth screen ── */
  if (!user) {
    return (
      <div className="auth-page">
        <ToastContainer toasts={toasts} />
        <div className="auth-card">
          <div className="auth-logo">🏀</div>
          <h1 className="auth-title">Dream Team</h1>
          <p className="auth-sub">Fantasy Draft</p>
          <div className="auth-tabs">
            <button className={`auth-tab ${authView === 'login' ? 'active' : ''}`} onClick={() => setAuthView('login')}>Login</button>
            <button className={`auth-tab ${authView === 'signup' ? 'active' : ''}`} onClick={() => setAuthView('signup')}>Sign Up</button>
          </div>
          {authView === 'signup' && (
            <input className="auth-input" placeholder="Display Name" value={displayName} onChange={e => setDisplayName(e.target.value)} />
          )}
          <input className="auth-input" type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
          <input className="auth-input" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAuth()} />
          {authError && <p className="auth-error">{authError}</p>}
          <button className="btn-primary" onClick={handleAuth}>{authView === 'login' ? 'Sign In' : 'Create Account'}</button>
        </div>
      </div>
    )
  }

  /* ── Nav ── */
  const NavBar = () => (
    <nav className="nav-bar">
      <button className={`nav-btn ${view === 'dashboard' ? 'active' : ''}`} onClick={() => { setView('dashboard'); setCurrentRoom(null) }}>🏠</button>
      <button className={`nav-btn ${view === 'bot' ? 'active' : ''}`} onClick={() => setView('bot')}>🤖</button>
      <button className={`nav-btn ${view === 'leaderboard' ? 'active' : ''}`} onClick={() => { setView('leaderboard'); loadLeaderboard() }}>🏆</button>
      <button className={`nav-btn ${view === 'profile' ? 'active' : ''}`} onClick={() => { setView('profile'); loadProfile() }}>👤</button>
    </nav>
  )

  /* ── Dashboard ── */
  if (view === 'dashboard' && !currentRoom) {
    return (
      <div className="app">
        <ToastContainer toasts={toasts} />
        <div className="page">
          <ThreeCourtHero />
          <h2 className="section-title">🏟️ Your Draft Rooms</h2>
          <div className="room-list">
            {rooms.length === 0 && <p className="empty-msg">No rooms yet. Create or join one!</p>}
            {rooms.map(r => (
              <div key={r.id} className="room-card" onClick={() => enterRoom(r)}>
                <div className="room-card-header">
                  <span className="room-name">{r.name}</span>
                  <span className={`room-status status-${r.status}`}>{r.status}</span>
                </div>
                <div className="room-card-footer">
                  <span>Code: <b>{r.code}</b></span>
                  <span>{r.max_slots} slots</span>
                </div>
              </div>
            ))}
          </div>

          <div className="section-divider" />

          <h3 className="section-title">➕ Create Room</h3>
          <div className="form-row">
            <input className="input" placeholder="Room Name" value={newRoomName} onChange={e => setNewRoomName(e.target.value)} />
            <select className="input select" value={newRoomSlots} onChange={e => setNewRoomSlots(+e.target.value)}>
              {[2, 4, 6, 8].map(n => <option key={n} value={n}>{n} players</option>)}
            </select>
          </div>
          <button className="btn-primary" onClick={createRoom}>Create Room</button>

          <div className="section-divider" />

          <h3 className="section-title">🔗 Join Room</h3>
          <div className="form-row">
            <input className="input" placeholder="Room Code" value={joinCode} onChange={e => setJoinCode(e.target.value)} />
            <button className="btn-secondary" onClick={joinRoom}>Join</button>
          </div>
        </div>
        <NavBar />
      </div>
    )
  }

  /* ── Room / Draft view ── */
  if (view === 'room' && currentRoom) {
    const isOwner = currentRoom.user_id === user.id
    const isMyTurn = draftState === 'active' && draftOrder[currentPickIdx] === user.id
    const currentDrafter = roomMembers.find(m => m.user_id === draftOrder[currentPickIdx])

    return (
      <div className="app">
        <ToastContainer toasts={toasts} />
        <div className="page">
          <div className="room-header">
            <button className="btn-back" onClick={() => { setView('dashboard'); setCurrentRoom(null); clearInterval(timerRef.current) }}>← Back</button>
            <div>
              <h2 className="room-title">{currentRoom.name}</h2>
              <p className="room-code">Code: {currentRoom.code}</p>
            </div>
          </div>

          {/* Members */}
          <div className="members-row">
            {roomMembers.map(m => (
              <div key={m.id} className={`member-chip ${draftState === 'active' && draftOrder[currentPickIdx] === m.user_id ? 'picking' : ''}`}>
                <span className="member-avatar">👤</span>
                <span>{m.display_name || 'Player'}</span>
              </div>
            ))}
          </div>

          {/* Draft controls */}
          {draftState === 'waiting' && isOwner && (
            <button className="btn-primary btn-large" onClick={startDraft}>🚀 Start Draft</button>
          )}
          {draftState === 'waiting' && !isOwner && (
            <p className="waiting-msg">Waiting for host to start the draft...</p>
          )}

          {draftState === 'active' && (
            <>
              <div className="draft-status-bar">
                <div className="draft-turn">
                  {isMyTurn ? '🟢 YOUR PICK!' : `⏳ ${currentDrafter?.display_name || 'Player'}'s pick`}
                </div>
                <div className="draft-timer">
                  <div className="timer-ring">{timer}s</div>
                </div>
                <div className="draft-round">Pick {currentPickIdx + 1} / {draftOrder.length}</div>
              </div>

              {/* Search */}
              <input className="input search-input" placeholder="🔍 Search NBA players..." value={playerSearch} onChange={e => setPlayerSearch(e.target.value)} />

              {/* Search results or available players */}
              <div className="player-grid">
                {(searchResults.length > 0 ? searchResults : availablePlayers).map((player, idx) => (
                  <div key={player.id} className="player-card" style={{ animationDelay: `${idx * 0.05}s` }}>
                    <div className="player-card-img">
                      {player.thumb ? <img src={player.thumb} alt={player.name} /> : <span className="player-emoji">🏀</span>}
                    </div>
                    <div className="player-card-info">
                      <span className="player-name">{player.name}</span>
                      <span className="player-team">{player.team}</span>
                      <span className="player-pos">{player.position}</span>
                      <span className="player-pts">{player.fantasyPts} FP</span>
                    </div>
                    <button className="btn-draft" onClick={() => makePick(player)} disabled={!isMyTurn}>Draft</button>
                  </div>
                ))}
                {searching && <p className="searching-msg">Searching...</p>}
              </div>

              {/* My roster */}
              {myRoster.length > 0 && (
                <>
                  <h3 className="section-title">📋 My Roster ({myRoster.length}/{MAX_ROSTER})</h3>
                  <div className="roster-list">
                    {myRoster.map(p => (
                      <div key={p.pick_number} className="roster-item">
                        <span className="roster-pick">#{p.pick_number}</span>
                        <span className="roster-name">{p.player_name}</span>
                        <span className="roster-team">{p.player_team}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {/* Complete */}
          {draftState === 'complete' && (
            <>
              <div className="draft-complete-banner">🏆 Draft Complete!</div>
              {matchups.length > 0 && (
                <>
                  <h3 className="section-title">⚔️ Matchups</h3>
                  <div className="matchup-list">
                    {matchups.map((m, i) => (
                      <div key={i} className="matchup-card">
                        <div className="matchup-team">
                          <span>Team {(roomMembers.findIndex(rm => rm.user_id === m.user_a) + 1) || '?'}</span>
                          <span className="matchup-score">{m.score_a}</span>
                        </div>
                        <span className="matchup-vs">VS</span>
                        <div className="matchup-team">
                          <span>Team {(roomMembers.findIndex(rm => rm.user_id === m.user_b) + 1) || '?'}</span>
                          <span className="matchup-score">{m.score_b}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
        <NavBar />
      </div>
    )
  }

  /* ── Bot Arena ── */
  if (view === 'bot') {
    const isMyTurn = botState === 'drafting' && botPickIdx % 2 === 0
    return (
      <div className="app">
        <ToastContainer toasts={toasts} />
        <div className="page">
          <h2 className="section-title">🤖 Bot Arena</h2>
          <p className="subtitle">Draft against the CPU. Snake draft, 4 picks each.</p>

          {botState === 'idle' && (
            <button className="btn-primary btn-large" onClick={startBotDraft} disabled={featuredLoading}>
              {featuredLoading ? 'Loading Players...' : '⚡ Start Bot Draft'}
            </button>
          )}

          {botState === 'drafting' && (
            <>
              <div className="draft-status-bar">
                <div className="draft-turn">
                  {isMyTurn ? '🟢 YOUR PICK!' : '🤖 CPU picking...'}
                </div>
                <div className="draft-timer"><div className="timer-ring">{botTimer}s</div></div>
                <div className="draft-round">Pick {botPickIdx + 1} / 8</div>
              </div>

              <input className="input search-input" placeholder="🔍 Search NBA players..." value={botSearch} onChange={e => setBotSearch(e.target.value)} />

              <div className="player-grid">
                {(botSearchResults.length > 0 ? botSearchResults : botPlayers).map((player, idx) => (
                  <div key={player.id} className="player-card" style={{ animationDelay: `${idx * 0.05}s` }}>
                    <div className="player-card-img">
                      {player.thumb ? <img src={player.thumb} alt={player.name} /> : <span className="player-emoji">🏀</span>}
                    </div>
                    <div className="player-card-info">
                      <span className="player-name">{player.name}</span>
                      <span className="player-team">{player.team}</span>
                      <span className="player-pos">{player.position}</span>
                      <span className="player-pts">{player.fantasyPts} FP</span>
                    </div>
                    <button className="btn-draft" onClick={() => botMakePick(player)} disabled={!isMyTurn}>Draft</button>
                  </div>
                ))}
                {botSearching && <p className="searching-msg">Searching...</p>}
              </div>
            </>
          )}

          {(botMyRoster.length > 0 || botCpuRoster.length > 0) && (
            <div className="bot-rosters">
              <div className="bot-roster">
                <h4>📋 Your Team</h4>
                {botMyRoster.map((p, i) => <div key={i} className="roster-item"><span className="roster-name">{p.name}</span><span className="roster-team">{p.team}</span></div>)}
              </div>
              <div className="bot-roster cpu">
                <h4>🤖 CPU Team</h4>
                {botCpuRoster.map((p, i) => <div key={i} className="roster-item"><span className="roster-name">{p.name}</span><span className="roster-team">{p.team}</span></div>)}
              </div>
            </div>
          )}

          {botState === 'complete' && (
            <>
              <div className="draft-complete-banner">🏆 Bot Draft Complete!</div>
              <div className="matchup-card">
                <div className="matchup-team">
                  <span>You</span>
                  <span className="matchup-score">{botMyRoster.reduce((s, p) => s + (p.fantasyPts || 0), 0)}</span>
                </div>
                <span className="matchup-vs">VS</span>
                <div className="matchup-team">
                  <span>CPU</span>
                  <span className="matchup-score">{botCpuRoster.reduce((s, p) => s + (p.fantasyPts || 0), 0)}</span>
                </div>
              </div>
              <button className="btn-primary" onClick={() => setBotState('idle')} style={{ marginTop: 16 }}>Play Again</button>
            </>
          )}
        </div>
        <NavBar />
      </div>
    )
  }

  /* ── Leaderboard ── */
  if (view === 'leaderboard') {
    return (
      <div className="app">
        <ToastContainer toasts={toasts} />
        <div className="page">
          <h2 className="section-title">🏆 Leaderboard</h2>
          <div className="leaderboard-list">
            {leaderboard.map((u, i) => (
              <div key={u.id} className="leaderboard-row">
                <span className="lb-rank">#{i + 1}</span>
                <span className="lb-name">{u.display_name || u.email || 'Player'}</span>
              </div>
            ))}
            {leaderboard.length === 0 && <p className="empty-msg">No players yet.</p>}
          </div>
        </div>
        <NavBar />
      </div>
    )
  }

  /* ── Profile ── */
  if (view === 'profile') {
    return (
      <div className="app">
        <ToastContainer toasts={toasts} />
        <div className="page">
          <h2 className="section-title">👤 Profile</h2>
          {profileLoading ? (
            <div className="loading-spinner" />
          ) : (
            <div className="profile-card">
              <div className="profile-avatar">🏀</div>
              <h3>{profile?.display_name || user.email}</h3>
              <p className="profile-email">{user.email}</p>
            </div>
          )}
          <button className="btn-danger" onClick={logout} style={{ marginTop: 24 }}>Sign Out</button>
        </div>
        <NavBar />
      </div>
    )
  }

  return (
    <div className="app">
      <ToastContainer toasts={toasts} />
      <div className="page"><p>Unknown view</p></div>
      <NavBar />
    </div>
  )
}