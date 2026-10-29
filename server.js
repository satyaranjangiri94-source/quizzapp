import express from 'express';
import session from 'express-session';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
await mkdir(DATA_DIR, { recursive: true });
let db = { users: [], quizzes: [], friendships: [] };
try { db = { ...db, ...JSON.parse(await readFile(DB_FILE, 'utf8')) }; } catch {}
let writeQueue = Promise.resolve();
function persist() {
  writeQueue = writeQueue.then(() => writeFile(DB_FILE, JSON.stringify(db, null, 2)));
  return writeQueue;
}
const app = express();
const server = createServer(app);
const allowedOrigin = process.env.FRONTEND_URL || true;
const io = new Server(server, { cors: { origin: allowedOrigin, credentials: true } });
app.set('trust proxy', 1);
app.use(cors({ origin: allowedOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret-before-deploying-' + randomBytes(16).toString('hex'),
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 86400000 }
}));
const publicUser = u => ({ id: u.id, email: u.email, displayName: u.displayName || u.email.split('@')[0], friendCode: u.friendCode });
const me = req => db.users.find(u => u.id === req.session.userId);
const requireUser = (req, res, next) => { if (!me(req)) return res.status(401).json({ error: 'Please log in first.' }); next(); };
const code6 = () => randomBytes(4).toString('hex').slice(0, 6).toUpperCase();

app.get('/api/auth/me', (req, res) => res.json({ user: me(req) ? publicUser(me(req)) : null }));
app.post('/api/auth/register', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Password must be 8–128 characters.' });
  if (db.users.some(u => u.email === email)) return res.status(409).json({ error: 'An account with that email already exists.' });
  let friendCode = code6(); while (db.users.some(u => u.friendCode === friendCode)) friendCode = code6();
  const requestedName = String(req.body?.displayName || '').trim().replace(/\s+/g, ' ').slice(0, 20);
  const displayName = requestedName || email.split('@')[0].slice(0, 20) || 'Player';
  const user = { id: randomUUID(), email, displayName, password: await bcrypt.hash(password, 12), friendCode };
  db.users.push(user); await persist(); req.session.userId = user.id; res.status(201).json({ user: publicUser(user) });
});
app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const user = db.users.find(u => u.email === email);
  if (!user || !await bcrypt.compare(String(req.body?.password || ''), user.password)) return res.status(401).json({ error: 'Email or password is incorrect.' });
  req.session.userId = user.id; res.json({ user: publicUser(user) });
});
app.post('/api/auth/google', async (req, res) => {
  try {
    const credential = String(req.body?.credential || '');
    if (!credential) return res.status(400).json({ error: 'Missing Google credential.' });
    const verified = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
    if (!verified.ok) return res.status(401).json({ error: 'Google sign-in could not be verified. Please try again.' });
    const claims = await verified.json();
    if (claims.aud !== '340776346318-hkg57974796tg20jmdckga1f27cici58.apps.googleusercontent.com' || claims.email_verified !== 'true' || !claims.sub || !claims.email) return res.status(401).json({ error: 'Google account verification failed.' });
    const email = String(claims.email).trim().toLowerCase();
    let user = db.users.find(u => u.email === email);
    if (!user) {
      let friendCode = code6(); while (db.users.some(u => u.friendCode === friendCode)) friendCode = code6();
      user = { id: randomUUID(), email, displayName: String(claims.name || email.split('@')[0]).trim().replace(/\s+/g, ' ').slice(0, 20) || 'Player', googleSub: claims.sub, friendCode, authProvider: 'google' };
      db.users.push(user); await persist();
    } else if (user.googleSub && user.googleSub !== claims.sub) {
      return res.status(401).json({ error: 'This email is linked to a different Google identity.' });
    } else if (!user.googleSub) { user.googleSub = claims.sub; await persist(); }
    req.session.userId = user.id;
    res.json({ user: publicUser(user) });
  } catch (error) {
    console.error('Google sign-in failed:', error);
    res.status(500).json({ error: 'Google sign-in failed. Please try again.' });
  }
});
app.patch('/api/profile', requireUser, async (req, res) => {
  const displayName = String(req.body?.displayName || '').trim().replace(/\s+/g, ' ');
  if (!displayName || displayName.length > 20 || /[\u0000-\u001f\u007f]/.test(displayName)) return res.status(400).json({ error: 'Username must be 1–20 characters and cannot contain control characters.' });
  const user = me(req); user.displayName = displayName; await persist(); res.json({ user: publicUser(user) });
});
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => { res.clearCookie('connect.sid'); res.json({ ok: true }); }));

app.get('/api/quizzes', (req, res) => {
  const user = me(req); const owner = user?.id || String(req.query.user || '');
  res.json(db.quizzes.filter(q => q.user === owner).map(({ user: _owner, ...q }) => q));
});
app.post('/api/quizzes', (req, res) => {
  const body = req.body || {};
  const owner = me(req)?.id || String(body.user || '');
  if (!owner) return res.status(400).json({ error: 'Missing quiz owner.' });
  const title = String(body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Give your quiz a title.' });
  const questions = Array.isArray(body.questions) ? body.questions.slice(0, 50).map(q => ({
    text: String(q.text || '').slice(0, 500), options: Array.isArray(q.options) ? q.options.slice(0, 4).map(x => String(x || '').slice(0, 250)) : ['', '', '', ''],
    correct: Math.max(0, Math.min(3, Number(q.correct) || 0)), seconds: [10,15,20,30,45,60].includes(Number(q.seconds)) ? Number(q.seconds) : 20
  })) : [];
  if (!questions.length || questions.some(q => !q.text.trim() || q.options.some(o => !o.trim()))) return res.status(400).json({ error: 'Add a question and fill all four answers before saving.' });
  let quiz;
  if (body.id) {
    quiz = db.quizzes.find(q => q.id === body.id && q.user === owner);
    if (quiz) Object.assign(quiz, { title, description: String(body.description || '').slice(0, 300), questions });
  }
  if (!quiz) { quiz = { id: randomUUID(), user: owner, title, description: String(body.description || '').slice(0, 300), questions }; db.quizzes.push(quiz); }
  persist().then(() => {}); const { user: _owner, ...safe } = quiz; res.json(safe);
});
app.delete('/api/quizzes/:id', (req, res) => {
  const owner = me(req)?.id || String(req.query.user || '');
  const before = db.quizzes.length; db.quizzes = db.quizzes.filter(q => !(q.id === req.params.id && q.user === owner));
  if (before === db.quizzes.length) return res.status(404).json({ error: 'Quiz not found.' });
  persist(); res.json({ ok: true });
});

app.get('/api/friends', requireUser, (req, res) => {
  const ids = db.friendships.filter(f => f.a === req.session.userId || f.b === req.session.userId).map(f => f.a === req.session.userId ? f.b : f.a);
  res.json(ids.map(id => db.users.find(u => u.id === id)).filter(Boolean).map(publicUser));
});
app.post('/api/friends', requireUser, (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  const friend = db.users.find(u => u.friendCode === code);
  if (!friend) return res.status(404).json({ error: 'No account found with that friend code.' });
  if (friend.id === req.session.userId) return res.status(400).json({ error: 'You cannot add yourself.' });
  if (db.friendships.some(f => [f.a, f.b].includes(req.session.userId) && [f.a, f.b].includes(friend.id))) return res.status(409).json({ error: 'You are already friends.' });
  db.friendships.push({ a: req.session.userId, b: friend.id }); persist(); res.status(201).json({ ok: true });
});
app.delete('/api/friends/:id', requireUser, (req, res) => {
  db.friendships = db.friendships.filter(f => !((f.a === req.session.userId && f.b === req.params.id) || (f.b === req.session.userId && f.a === req.params.id)));
  persist(); res.json({ ok: true });
});

const rooms = new Map();
function roomCode() { let c; do { c = code6(); } while (rooms.has(c)); return c; }
function snapshot(room) {
  const players = [...room.players.values()].map(p => ({ id: p.id, name: p.name, score: p.score, connected: p.connected, hasAnswered: p.hasAnswered, isHost: p.id === room.hostId }));
  const out = { code: room.code, phase: room.phase, quizTitle: room.quiz.title, players, round: room.round };
  if (room.phase === 'question') out.question = { number: room.index + 1, total: room.quiz.questions.length, text: room.quiz.questions[room.index].text, options: room.quiz.questions[room.index].options, seconds: room.quiz.questions[room.index].seconds, endsAt: room.endsAt };
  if (room.phase === 'reveal') out.answer = { text: room.quiz.questions[room.index].text, options: room.quiz.questions[room.index].options, correct: room.quiz.questions[room.index].correct };
  if (room.phase === 'results') out.leaderboard = players.sort((a,b) => b.score - a.score);
  return out;
}
function broadcast(room) { io.to(room.code).emit('state', snapshot(room)); }
function clearTimer(room) { if (room.timer) clearTimeout(room.timer); room.timer = null; }
function reveal(room) {
  clearTimer(room); if (!rooms.has(room.code)) return;
  room.phase = 'reveal'; broadcast(room);
  room.timer = setTimeout(() => {
    if (room.index + 1 >= room.quiz.questions.length) { room.phase = 'results'; room.round++; broadcast(room); }
    else { room.index++; beginQuestion(room); }
  }, 2500);
}
function beginQuestion(room) {
  clearTimer(room); room.phase = 'question'; room.players.forEach(p => { p.hasAnswered = false; p.answer = null; });
  room.endsAt = Date.now() + room.quiz.questions[room.index].seconds * 1000;
  broadcast(room); room.timer = setTimeout(() => reveal(room), room.quiz.questions[room.index].seconds * 1000);
}
app.post('/api/rooms', (req, res) => {
  const quiz = req.body?.quiz; if (!quiz || !Array.isArray(quiz.questions) || !quiz.questions.length) return res.status(400).json({ error: 'Choose a quiz with questions first.' });
  const code = roomCode(), hostKey = randomBytes(18).toString('hex');
  rooms.set(code, { code, hostKey, hostId: null, quiz, phase: 'lobby', players: new Map(), index: 0, round: 0, timer: null });
  res.status(201).json({ code, hostKey });
});
io.on('connection', socket => {
  socket.on('join', (payload = {}, cb = () => {}) => {
    const code = String(payload.code || '').toUpperCase(), room = rooms.get(code);
    if (!room) return cb({ error: 'Room not found. Check the code with your host.' });
    const id = String(payload.id || randomUUID()).slice(0, 80), name = String(payload.name || 'Player').trim().slice(0, 20) || 'Player';
    if (room.phase !== 'lobby' && !room.players.has(id)) return cb({ error: 'This quiz has already started.' });
    let player = room.players.get(id);
    if (!player) { player = { id, name, score: 0, connected: true, hasAnswered: false, answer: null }; room.players.set(id, player); }
    player.name = name; player.connected = true; player.socketId = socket.id;
    if (!room.hostId || payload.hostKey && payload.hostKey === room.hostKey) room.hostId = id;
    socket.data.room = code; socket.data.playerId = id; socket.join(code);
    cb({ id }); broadcast(room);
  });
  socket.on('start', () => { const room = rooms.get(socket.data.room); if (!room || room.players.get(socket.data.playerId)?.id !== room.hostId || room.phase !== 'lobby' || room.players.size < 1) return; room.index = 0; room.round++; room.players.forEach(p => p.score = 0); beginQuestion(room); });
  socket.on('answer', (choice, cb = () => {}) => {
    const room = rooms.get(socket.data.room), p = room?.players.get(socket.data.playerId);
    if (!room || room.phase !== 'question' || !p || p.hasAnswered) return cb({ error: 'Your answer has already been locked, or the question has ended.' });
    if (Date.now() >= room.endsAt) { reveal(room); return cb({ error: 'Time is up!' }); }
    const q = room.quiz.questions[room.index], selected = Number(choice);
    if (!Number.isInteger(selected) || selected < 0 || selected > 3) return cb({ error: 'Choose one of the answers.' });
    p.hasAnswered = true; p.answer = selected;
    if (selected === q.correct) p.score += Math.max(100, Math.round(1000 * Math.max(0, room.endsAt - Date.now()) / (q.seconds * 1000)));
    cb({ ok: true }); broadcast(room);
    if ([...room.players.values()].every(x => x.hasAnswered)) reveal(room);
  });
  socket.on('remove', targetId => {
    const room = rooms.get(socket.data.room); if (!room || room.hostId !== socket.data.playerId || !room.players.has(targetId)) return;
    const target = room.players.get(targetId); if (target.socketId) io.to(target.socketId).emit('removed');
    room.players.delete(targetId); broadcast(room);
  });
  socket.on('replay', () => {
    const room = rooms.get(socket.data.room); if (!room || room.hostId !== socket.data.playerId || room.phase !== 'results') return;
    room.index = 0; room.players.forEach(p => p.score = 0); room.round++; beginQuestion(room);
  });
  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.room), p = room?.players.get(socket.data.playerId);
    if (p && p.socketId === socket.id) { p.connected = false; broadcast(room); }
  });
});

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res, next) => { if (req.path.startsWith('/api/')) return next(); res.sendFile(path.join(__dirname, 'dist', 'index.html')); });
server.listen(PORT, '0.0.0.0', () => console.log(`QuizNest listening on ${PORT}`));
