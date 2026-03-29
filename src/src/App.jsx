import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase, TABLES } from './supabaseClient';
import { searchPlayers, loadFeaturedPlayers } from './nbaApi';

/* ========== tiny helpers ========== */
const wait = ms => new Promise(r => setTimeout(r, ms));
const randId = () => Math.random().toString(36).slice(2, 10);
const fantasyPts = () => Math.floor(Math.random() * 30 + 10);

/* ========== Three-style hero (pure CSS orb) ========== */
function ThreeCourtHero() {
  return (
    <div className="hero-3d">
      <div className="court-orb">
        <div className="orb-ring ring1"></div>
        <div className="orb-ring ring2"></div>
        <div className="orb-ring ring3"></div>
        <div className="orb-core">ð</div>
      </div>
    </div>
  );
}

/* ========== Toast ========== */
function Toast({ msg, type, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 2400); return () => clearTimeout(t); }, []);
  return <div className={`toast toast-${type}`}>{msg}</div>;
}

/* ========== Main App ========== */
export default function App() {
  /* --- auth --- */
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [authErr, setAuthErr] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  /* --- nav --- */
  const [view, setView] = useState('dash');        // dash | draft | profile | leaderboard | bot
  const [toast, setToast] = useState(null);

  /* --- rooms --- */
  const [rooms, setRooms] = useState([]);
  const [currentRoom, setCurrentRoom] = useState(null);
  const [members, setMembers] = useState([]);

  /* --- draft --- */
  const [draftOrder, setDraftOrder] = useState([]);
  const [currentPick, setCurrentPick] = useState(0);
  const [picks, setPicks] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [featured, setFeatured] = useState([]);
  const [searching, setSearching] = useState(false);
  const [draftStarted, setDraftStarted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef = useRef(null);

  /* --- leaderboard --- */
  const [leaderboard, setLeaderboard] = useState([]);

  /* --- bot arena --- */
  const [botDrafting, setBotDrafting] = useState(false);
  const [botResults, setBotResults] = useState(null);

  /* --- profile --- */
  const [displayName, setDisplayName] = useState('');
  const [avatar, setAvatar] = useState('ð');
  const avatarChoices = ['ð', 'ð¥', 'â¡', 'ð', 'ð¯', 'ð', 'ð', 'ð¡ï¸'];

  /* ===================== AUTH ===================== */
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) { setUser(data.user); loadProfile(data.user.id); }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_, s) => {
      if (s?.user) { setUser(s.user); loadProfile(s.user.id); }
      else { setUser(null); setProfile(null); }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function loadProfile(uid) {
    const { data } = await supabase.from(TABLES.users).select('*').eq('user_id', uid).maybeSingle();
    if (data) { setProfile(data); setDisplayName(data.display_name || ''); setAvatar(data.avatar || 'ð'); }
  }

  async function handleAuth() {
    setAuthErr(''); setAuthLoading(true);
    try {
      if (authMode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email, password: pw,
          options: { emailRedirectTo: 'https://sling-gogiapp.web.app/email-confirmed.html' }
        });
        if (error) throw error;
        notify('Check your email to confirm!', 'success');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
        if (error) throw error;
      }
    } catch (e) { setAuthErr(e.message); }
    setAuthLoading(false);
  }

  async function logout() {
    await supabase.auth.signOut();
    setView('dash'); setCurrentRoom(null);
  }

  /* ===================== PROFILE ===================== */
  async function saveProfile() {
    if (!user) return;
    const row = { user_id: user.id, display_name: displayName, avatar };
    if (profile) {
      await supabase.from(TABLES.users).update(row).eq('id', profile.id);
    } else {
      await supabase.from(TABLES.users).insert(row);
    }
    await loadProfile(user.id);
    notify('Profile saved!', 'success');
    setView('dash');
  }

  /* ===================== ROOMS ===================== */
  useEffect(() => { if (user) fetchRooms(); }, [user]);

  async function fetchRooms() {
    const { data } = await supabase.from(TABLES.rooms).select('*').order('created_at', { ascending: false }).limit(20);
    setRooms(data || []);
  }

  async function createRoom() {
    if (!user) return;
    const code = randId().toUpperCase().slice(0, 6);
    const { data, error } = await supabase.from(TABLES.rooms).insert({
      user_id: user.id, code, name: `${profile?.display_name || 'Player'}'s Room`,
      max_players: 4, status: 'waiting'
    }).select().single();
    if (error) { notify(error.message, 'error'); return; }
    await joinRoom(data);
    notify(`Room ${code} created!`, 'success');
  }

  async function joinRoom(room) {
    if (!user) return;
    const existing = await supabase.from(TABLES.members).select('id').eq('room_id', room.id).eq('user_id', user.id).maybeSingle();
    if (!existing.data) {
      await supabase.from(TABLES.members).insert({ user_id: user.id, room_id: room.id, display_name: profile?.display_name || 'Player', avatar: avatar });
    }
    setCurrentRoom(room);
    await loadMembers(room.id);
    setView('draft');
    await loadDraft(room.id);
  }

  async function joinByCode(code) {
    const { data } = await supabase.from(TABLES.rooms).select('*').eq('code', code.toUpperCase()).maybeSingle();
    if (data) joinRoom(data);
    else notify('Room not found', 'error');
  }

  async function loadMembers(roomId) {
    const { data } = await supabase.from(TABLES.members).select('*').eq('room_id', roomId);
    setMembers(data || []);
    return data || [];
  }

  /* ===================== DRAFT ===================== */
  useEffect(() => { loadFeaturedPlayers().then(f => setFeatured(f)); }, []);

  async function loadDraft(roomId) {
    const { data: p } = await supabase.from(TABLES.picks).select('*').eq('room_id', roomId).order('pick_number');
    setPicks(p || []);
    if (p && p.length) {
      setCurrentPick(p.length);
      setDraftStarted(true);
    }
  }

  function buildSnakeOrder(membersList, rounds = 3) {
    const order = [];
    for (let r = 0; r < rounds; r++) {
      const arr = membersList.map(m => m.id);
      if (r % 2 === 1) arr.reverse();
      order.push(...arr);
    }
    return order;
  }

  async function startDraft() {
    if (!currentRoom) return;
    const mems = await loadMembers(currentRoom.id);
    if (mems.length < 2) { notify('Need at least 2 players', 'error'); return; }
    const order = buildSnakeOrder(mems);
    setDraftOrder(order);
    setCurrentPick(0);
    setPicks([]);
    setDraftStarted(true);
    await supabase.from(TABLES.rooms).update({ status: 'drafting' }).eq('id', currentRoom.id);
    startTimer();
    notify('Draft started! ð¥', 'success');
  }

  function startTimer() {
    setTimeLeft(30);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(timerRef.current); autoPick(); return 0; }
        return prev - 1;
      });
    }, 1000);
  }

  async function autoPick() {
    if (featured.length) {
      const available = featured.filter(f => !picks.some(p => p.player_id === f.id));
      if (available.length) { await draftPlayer(available[0]); return; }
    }
    notify('No player available for auto-pick', 'error');
  }

  async function draftPlayer(player) {
    if (!currentRoom || !draftStarted) return;
    const alreadyPicked = picks.some(p => p.player_id === player.id);
    if (alreadyPicked) { notify('Already drafted!', 'error'); return; }

    const memberId = draftOrder[currentPick];
    const member = members.find(m => m.id === memberId);
    const pts = fantasyPts();

    const pickRow = {
      user_id: user.id, room_id: currentRoom.id, member_id: memberId,
      player_id: player.id, player_name: player.name, player_team: player.team,
      player_pos: player.pos, player_thumb: player.thumb,
      pick_number: currentPick, fantasy_pts: pts
    };

    const { error } = await supabase.from(TABLES.picks).insert(pickRow);
    if (error) { notify(error.message, 'error'); return; }

    const newPicks = [...picks, pickRow];
    setPicks(newPicks);

    notify(`${member?.display_name || 'Player'} drafted ${player.name}! (${pts} pts)`, 'success');

    const next = currentPick + 1;
    if (next >= draftOrder.length) {
      clearInterval(timerRef.current);
      setDraftStarted(false);
      await supabase.from(TABLES.rooms).update({ status: 'complete' }).eq('id', currentRoom.id);
      notify('Draft complete! ð', 'success');
      generateMatchups(newPicks);
    } else {
      setCurrentPick(next);
      startTimer();
    }
  }

  /* ===================== MATCHUPS ===================== */
  async function generateMatchups(allPicks) {
    if (!currentRoom || members.length < 2) return;
    const matchups = [];
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const m1 = members[i], m2 = members[j];
        const pts1 = allPicks.filter(p => p.member_id === m1.id).reduce((s, p) => s + (p.fantasy_pts || 0), 0);
        const pts2 = allPicks.filter(p => p.member_id === m2.id).reduce((s, p) => s + (p.fantasy_pts || 0), 0);
        matchups.push({
          user_id: user.id, room_id: currentRoom.id,
          member1_id: m1.id, member2_id: m2.id,
          member1_name: m1.display_name, member2_name: m2.display_name,
          member1_pts: pts1, member2_pts: pts2,
          winner_id: pts1 > pts2 ? m1.id : pts2 > pts1 ? m2.id : null
        });
      }
    }
    await supabase.from(TABLES.matchups).insert(matchups);
  }

  /* ===================== LEADERBOARD ===================== */
  async function loadLeaderboard() {
    const { data } = await supabase.from(TABLES.picks).select('member_id, player_name, fantasy_pts, room_id').order('fantasy_pts', { ascending: false }).limit(50);
    setLeaderboard(data || []);
    setView('leaderboard');
  }

  /* ===================== BOT ARENA ===================== */
  async function startBotArena() {
    setBotDrafting(true); setBotResults(null); setView('bot');
    const pool = featured.length ? [...featured] : [];
    if (!pool.length) { notify('Loading players...', 'error'); setBotDrafting(false); return; }
    const userTeam = [], botTeam = [];
    const shuffled = pool.sort(() => Math.random() - 0.5);
    for (let i = 0; i < Math.min(6, shuffled.length); i++) {
      await wait(600);
      if (i % 2 === 0) userTeam.push({ ...shuffled[i], pts: fantasyPts() });
      else botTeam.push({ ...shuffled[i], pts: fantasyPts() });
    }
    const uTotal = userTeam.reduce((s, p) => s + p.pts, 0);
    const bTotal = botTeam.reduce((s, p) => s + p.pts, 0);
    setBotResults({ userTeam, botTeam, uTotal, bTotal, win: uTotal > bTotal });
    setBotDrafting(false);
    if (user) {
      await supabase.from(TABLES.botMatches).insert({
        user_id: user.id, user_pts: uTotal, bot_pts: bTotal, won: uTotal > bTotal
      });
    }
  }

  /* ===================== SEARCH ===================== */
  const debounceRef = useRef(null);
  function handleSearch(val) {
    setSearchTerm(val);
    clearTimeout(debounceRef.current);
    if (val.length < 2) { setSearchResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      const r = await searchPlayers(val);
      setSearchResults(r);
      setSearching(false);
    }, 350);
  }

  /* ===================== HELPERS ===================== */
  function notify(msg, type = 'info') { setToast({ msg, type, key: Date.now() }); }
  function myPicks() { return picks.filter(p => p.member_id === members.find(m => m.user_id === user?.id)?.id); }
  function isMyTurn() {
    if (!draftStarted || !draftOrder.length) return false;
    const mem = members.find(m => m.user_id === user?.id);
    return mem && draftOrder[currentPick] === mem.id;
  }

  /* ===================== RENDER ===================== */
  if (!user) {
    return (
      <div className="app auth-screen">
        <ThreeCourtHero />
        <div className="auth-card glass-panel">
          <h1 className="brand">ð Dream Team</h1>
          <p className="brand-sub">Fantasy Draft</p>
          <div className="auth-tabs">
            <button className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>Login</button>
            <button className={authMode === 'signup' ? 'active' : ''} onClick={() => setAuthMode('signup')}>Sign Up</button>
          </div>
          {authErr && <p className="auth-error">{authErr}</p>}
          <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
          <input placeholder="Password" type="password" value={pw} onChange={e => setPw(e.target.value)} />
          <button className="btn-accent" onClick={handleAuth} disabled={authLoading}>
            {authLoading ? 'Loading...' : authMode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </div>
        {toast && <Toast key={toast.key} msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
      </div>
    );
  }

  /* ---- Dashboard ---- */
  if (view === 'dash') {
    return (
      <div className="app">
        <header className="top-bar glass-panel">
          <span className="logo">ð Dream Team</span>
          <nav>
            <button onClick={() => setView('profile')}>ð§</button>
            <button onClick={loadLeaderboard}>ð</button>
            <button onClick={logout}>â</button>
          </nav>
        </header>

        <div className="dash">
          <h2>Welcome, {profile?.display_name || 'Player'}!</h2>

          <div className="dash-grid">
            <div className="dash-card glass-panel" onClick={createRoom}>
              <span className="dash-icon">ð</span>
              <h3>Create Room</h3>
              <p>Start a new draft room</p>
            </div>
            <div className="dash-card glass-panel" onClick={() => {
              const code = prompt('Enter room code:');
              if (code) joinByCode(code);
            }}>
              <span className="dash-icon">ð</span>
              <h3>Join Room</h3>
              <p>Enter with a code</p>
            </div>
            <div className="dash-card glass-panel" onClick={startBotArena}>
              <span className="dash-icon">ð¤</span>
              <h3>Bot Arena</h3>
              <p>Draft vs AI opponent</p>
            </div>
            <div className="dash-card glass-panel" onClick={loadLeaderboard}>
              <span className="dash-icon">ð</span>
              <h3>Leaderboard</h3>
              <p>Top fantasy scores</p>
            </div>
          </div>

          <h3 className="section-title">Open Rooms</h3>
          <div className="room-list">
            {rooms.length === 0 && <p className="empty">No rooms yet â create one!</p>}
            {rooms.map(r => (
              <div key={r.id} className="room-card glass-panel" onClick={() => joinRoom(r)}>
                <div className="room-info">
                  <strong>{r.name}</strong>
                  <span className="room-code">Code: {r.code}</span>
                </div>
                <span className={`room-status s-${r.status}`}>{r.status} Â· {r.max_players} max</span>
              </div>
            ))}
          </div>
        </div>
        {toast && <Toast key={toast.key} msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
      </div>
    );
  }

  /* ---- Profile ---- */
  if (view === 'profile') {
    return (
      <div className="app">
        <header className="top-bar glass-panel">
          <button onClick={() => setView('dash')}>â Back</button>
          <span className="logo">Profile</span>
        </header>
        <div className="profile-page">
          <div className="avatar-big">{avatar}</div>
          <div className="avatar-picker">
            {avatarChoices.map(a => (
              <button key={a} className={a === avatar ? 'active' : ''} onClick={() => setAvatar(a)}>{a}</button>
            ))}
          </div>
          <input placeholder="Display Name" value={displayName} onChange={e => setDisplayName(e.target.value)} />
          <button className="btn-accent" onClick={saveProfile}>Save Profile</button>
        </div>
        {toast && <Toast key={toast.key} msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
      </div>
    );
  }

  /* ---- Leaderboard ---- */
  if (view === 'leaderboard') {
    return (
      <div className="app">
        <header className="top-bar glass-panel">
          <button onClick={() => setView('dash')}>â Back</button>
          <span className="logo">ð Leaderboard</span>
        </header>
        <div className="leaderboard">
          {leaderboard.length === 0 && <p className="empty">No picks yet</p>}
          {leaderboard.map((entry, i) => (
            <div key={i} className="lb-row glass-panel">
              <span className="lb-rank">#{i + 1}</span>
              <span className="lb-name">{entry.player_name}</span>
              <span className="lb-pts">{entry.fantasy_pts} pts</span>
            </div>
          ))}
        </div>
        {toast && <Toast key={toast.key} msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
      </div>
    );
  }

  /* ---- Bot Arena ---- */
  if (view === 'bot') {
    return (
      <div className="app">
        <header className="top-bar glass-panel">
          <button onClick={() => setView('dash')}>â Back</button>
          <span className="logo">ð¤ Bot Arena</span>
        </header>
        <div className="bot-arena">
          {botDrafting && <div className="bot-loading"><div className="spinner"></div><p>Drafting against AI...</p></div>}
          {botResults && (
            <div className="bot-results">
              <h2 className={botResults.win ? 'win' : 'lose'}>{botResults.win ? 'ð You Win!' : 'ð¤ Bot Wins!'}</h2>
              <div className="bot-matchup">
                <div className="bot-team">
                  <h3>Your Team ({botResults.uTotal} pts)</h3>
                  {botResults.userTeam.map((p, i) => (
                    <div key={i} className="bot-player">
                      {p.thumb && <img src={p.thumb} alt={p.name} />}
                      <span>{p.name}</span>
                      <span className="pts">{p.pts}</span>
                    </div>
                  ))}
                </div>
                <div className="bot-vs">VS</div>
                <div className="bot-team">
                  <h3>Bot ({botResults.bTotal} pts)</h3>
                  {botResults.botTeam.map((p, i) => (
                    <div key={i} className="bot-player">
                      {p.thumb && <img src={p.thumb} alt={p.name} />}
                      <span>{p.name}</span>
                      <span className="pts">{p.pts}</span>
                    </div>
                  ))}
                </div>
              </div>
              <button className="btn-accent" onClick={startBotArena}>Rematch</button>
            </div>
          )}
        </div>
        {toast && <Toast key={toast.key} msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
      </div>
    );
  }

  /* ---- Draft Room ---- */
  return (
    <div className="app">
      <header className="top-bar glass-panel">
        <button onClick={() => { setView('dash'); setCurrentRoom(null); }}>â Back</button>
        <span className="logo">{currentRoom?.name || 'Draft Room'}</span>
        <span className="room-code-badge">{currentRoom?.code}</span>
      </header>

      {/* Draft HUD */}
      <div className="draft-hud glass-panel">
        <div className="hud-item">
          <span className="hud-label">Round</span>
          <span className="hud-val">{Math.floor(currentPick / Math.max(members.length, 1)) + 1}</span>
        </div>
        <div className="hud-item">
          <span className="hud-label">Pick</span>
          <span className="hud-val">{currentPick + 1}/{draftOrder.length || '?'}</span>
        </div>
        <div className="hud-item">
          <span className="hud-label">Timer</span>
          <span className={`hud-val timer ${timeLeft <= 10 ? 'urgent' : ''}`}>{timeLeft}s</span>
        </div>
      </div>

      {/* Members bar */}
      <div className="members-bar">
        {members.map(m => (
          <div key={m.id} className={`member-chip ${draftStarted && draftOrder[currentPick] === m.id ? 'active' : ''}`}>
            <span className="member-avatar">{m.avatar || 'ð'}</span>
            <span className="member-name">{m.display_name}</span>
          </div>
        ))}
      </div>

      {!draftStarted && (
        <div className="draft-actions">
          <button className="btn-accent big" onClick={startDraft}>ð Start Draft</button>
          <p className="hint">{members.length} player{members.length !== 1 ? 's' : ''} in room</p>
        </div>
      )}

      {/* Search */}
      {draftStarted && isMyTurn() && (
        <div className="search-section">
          <input placeholder="Search NBA players..." value={searchTerm} onChange={e => handleSearch(e.target.value)} className="search-input" />
          {searching && <div className="spinner small"></div>}
        </div>
      )}

      {/* Player grid */}
      <div className="player-grid">
        {(searchResults.length ? searchResults : featured).map(p => {
          const drafted = picks.some(pk => pk.player_id === p.id);
          return (
            <div key={p.id} className={`player-card glass-panel ${drafted ? 'drafted' : ''}`}>
              <div className="player-visual">
                {p.thumb ? <img src={p.thumb} alt={p.name} /> : <div className="player-fallback">ð</div>}
              </div>
              <div className="player-info">
                <h4>{p.name}</h4>
                <p className="player-team">{p.team} Â· {p.pos}</p>
              </div>
              {draftStarted && isMyTurn() && !drafted && (
                <button className="draft-btn" onClick={() => draftPlayer(p)}>Draft</button>
              )}
              {drafted && <span className="drafted-badge">Drafted</span>}
            </div>
          );
        })}
      </div>

      {/* My Picks */}
      {picks.length > 0 && (
        <div className="my-picks">
          <h3>ð My Picks</h3>
          <div className="pick-list">
            {myPicks().map((p, i) => (
              <div key={i} className="pick-chip">
                {p.player_thumb && <img src={p.player_thumb} alt="" />}
                <span>{p.player_name}</span>
                <span className="pick-pts">{p.fantasy_pts} pts</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {toast && <Toast key={toast.key} msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}
