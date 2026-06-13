// server.js
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { GameManager } from './src/GameManager.js';
import { store } from './src/store.js';
import { SRD } from './src/srd.js';
import { QUICK_DICE } from './src/dice.js';
import { computeCharacter } from './src/Character.js';
import {
  validateConfig, buildCharacterRaw, validateRoomCode,
  sanitizeLabel, sanitizeChat, sanitizeExpression, sanitizeText, validateAvatar, clampInt, LIMITS,
} from './src/validate.js';
import { createRateLimiter, RATE } from './src/rateLimiter.js';
import {
  hashPassword, verifyPassword, validateEmail, validatePassword, validateBirthdate, MIN_AGE,
} from './src/auth.js';
import { sendConfirmationEmail, mailerMode } from './src/mailer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const IS_PROD = process.env.NODE_ENV === 'production';
const MAX_ROOMS = parseInt(process.env.MAX_ROOMS || '2000', 10);
const MAX_CONN_PER_IP = parseInt(process.env.MAX_CONN_PER_IP || '60', 10);
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean) : null;

process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

// hash "fantasma" para igualar o tempo de resposta de login (anti-enumeração)
const DUMMY = await hashPassword('placeholder-not-a-real-password');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// ---------- Headers de segurança ----------
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "manifest-src 'self'",
].join('; ');

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

app.use(express.json({ limit: '16kb' }));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: ALLOWED_ORIGINS || true, methods: ['GET', 'POST'], credentials: false },
  maxHttpBufferSize: 1e6,
  pingTimeout: 20000,
});

const gm = new GameManager();
const rl = createRateLimiter();   // socket
const httpRL = createRateLimiter(); // http (por IP)
setInterval(() => store.prune(), 60 * 60 * 1000).unref?.();

// ---------- Estáticos + API pública ----------
app.use(express.static(join(__dirname, 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=300'),
}));
app.get('/api/srd', (_req, res) => res.json({ ...SRD, quickDice: QUICK_DICE }));
app.get('/api/meta', (_req, res) => res.json({ stats: gm.stats }));
app.get('/api/health', (_req, res) => res.json({ ok: true, ...gm.stats }));

// ================= AUTENTICAÇÃO (HTTP) =================
function httpAllow(req, key, max, win, res) {
  const ip = req.ip || 'unknown';
  if (!httpRL.check(ip, key, max, win)) {
    res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
    return false;
  }
  return true;
}
function bearer(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}
app.use('/api/auth', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

// Registrar
app.post('/api/auth/register', async (req, res) => {
  if (!httpAllow(req, 'register', 8, 10 * 60 * 1000, res)) return;
  try {
    const name = sanitizeText(req.body?.name, 30);
    const email = validateEmail(req.body?.email);
    const password = validatePassword(req.body?.password);
    const bd = validateBirthdate(req.body?.birthdate);
    if (!name) return res.status(400).json({ error: 'Informe seu nome.' });
    if (!email) return res.status(400).json({ error: 'E-mail inválido.' });
    if (!password) return res.status(400).json({ error: 'A senha precisa de ao menos 8 caracteres.' });
    if (!bd) return res.status(400).json({ error: 'Data de nascimento inválida.' });
    if (bd.age < MIN_AGE) return res.status(400).json({ error: `É preciso ter ao menos ${MIN_AGE} anos para criar uma conta.` });
    if (store.findUserByEmail(email)) return res.status(409).json({ error: 'Já existe uma conta com este e-mail.' });

    const { salt, hash } = await hashPassword(password);
    const user = store.createUser({ email, name, avatar: '🧙', birthdate: bd.birthdate, salt, hash });
    const token = store.createEmailToken(user.id);
    const url = `${APP_URL}/api/auth/confirm?token=${encodeURIComponent(token)}`;
    const mail = await sendConfirmationEmail(email, name, url);
    res.json({ ok: true, needsConfirm: true, ...(mail.devUrl && !IS_PROD ? { devConfirmUrl: mail.devUrl } : {}) });
  } catch (e) { console.error('register', e); res.status(500).json({ error: 'Erro ao criar a conta.' }); }
});

// Confirmar e-mail
app.get('/api/auth/confirm', (req, res) => {
  const userId = store.consumeEmailToken(req.query?.token);
  if (!userId) return res.redirect('/?confirmado=0');
  store.verifyUserEmail(userId);
  res.redirect('/?confirmado=1');
});

// Login
app.post('/api/auth/login', async (req, res) => {
  if (!httpAllow(req, 'login', 15, 10 * 60 * 1000, res)) return;
  const generic = 'E-mail ou senha incorretos.';
  try {
    const email = validateEmail(req.body?.email);
    const password = req.body?.password;
    if (!email || typeof password !== 'string') { await verifyPassword('x', DUMMY.salt, DUMMY.hash); return res.status(401).json({ error: generic }); }
    const user = store.findUserByEmail(email);
    if (!user) { await verifyPassword(password, DUMMY.salt, DUMMY.hash); return res.status(401).json({ error: generic }); }
    const ok = await verifyPassword(password, user.salt, user.hash);
    if (!ok) return res.status(401).json({ error: generic });
    if (!user.emailVerified) return res.status(403).json({ error: 'Confirme seu e-mail antes de entrar.', needsConfirm: true, email: user.email });
    const token = store.createAuthSession(user.id);
    res.json({ ok: true, token, user: store.publicUser(user) });
  } catch (e) { console.error('login', e); res.status(500).json({ error: 'Erro ao entrar.' }); }
});

// Reenviar confirmação
app.post('/api/auth/resend', async (req, res) => {
  if (!httpAllow(req, 'resend', 5, 10 * 60 * 1000, res)) return;
  const email = validateEmail(req.body?.email);
  let devConfirmUrl;
  if (email) {
    const user = store.findUserByEmail(email);
    if (user && !user.emailVerified) {
      const token = store.createEmailToken(user.id);
      const url = `${APP_URL}/api/auth/confirm?token=${encodeURIComponent(token)}`;
      const mail = await sendConfirmationEmail(email, user.name, url);
      if (mail.devUrl && !IS_PROD) devConfirmUrl = mail.devUrl;
    }
  }
  res.json({ ok: true, ...(devConfirmUrl ? { devConfirmUrl } : {}) }); // não revela se a conta existe
});

// Sessão atual
app.get('/api/auth/me', (req, res) => {
  const user = store.getUserByToken(bearer(req));
  if (!user) return res.status(401).json({ error: 'Sessão inválida.' });
  res.json({ ok: true, user: store.publicUser(user) });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  store.deleteAuthSession(bearer(req) || req.body?.token);
  res.json({ ok: true });
});

// erro de JSON malformado
app.use((err, _req, res, _next) => {
  if (err) return res.status(400).json({ error: 'Requisição inválida.' });
  res.status(500).end();
});

// ---------- Helpers de jogo ----------
const emitRoom = (room, ev, payload) => io.to(room.code).emit(ev, payload);
const broadcastState = (room) => emitRoom(room, 'room:state', room.toState());
const pushLog = (room, entry) => { if (entry) emitRoom(room, 'log:entry', entry); };
const autosave = (room) => { if (room) gm.checkpoint(room.code); };

function allow(socket, key, cb) {
  const rule = RATE[key] || RATE.global;
  const okGlobal = rl.check(socket.id, '_global', RATE.global[0], RATE.global[1]);
  const okKey = rl.check(socket.id, key, rule[0], rule[1]);
  if (!okGlobal || !okKey) {
    if (typeof cb === 'function') cb({ ok: false, error: 'Calma! Muitas ações em pouco tempo. Aguarde um instante.' });
    return false;
  }
  return true;
}
const cleanCharId = (v) => (typeof v === 'string' && /^[\w-]{1,40}$/.test(v)) ? v : null;

/** Identidade vem do login (servidor), nunca do cliente. */
function authedProfile(socket) {
  const u = socket.data.user;
  if (!u) return null;
  const pub = store.publicUser(u);
  return { id: u.id, name: u.name, avatar: u.avatar, isAdult: pub.isAdult };
}

// ---------- Socket.IO ----------
const ipConns = new Map();

// autenticação na conexão
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  socket.data.user = token ? store.getUserByToken(token) : null;
  next();
});

io.on('connection', (socket) => {
  const ip = socket.handshake.address || 'unknown';
  ipConns.set(ip, (ipConns.get(ip) || 0) + 1);
  if (ipConns.get(ip) > MAX_CONN_PER_IP) {
    socket.emit('security:notice', 'Muitas conexões deste dispositivo.');
    ipConns.set(ip, ipConns.get(ip) - 1);
    socket.disconnect(true);
    return;
  }

  const requireAuth = (cb) => {
    if (!socket.data.user) { cb?.({ ok: false, error: 'Faça login para continuar.' }); return false; }
    return true;
  };

  // painel inicial (perfil + sessões pausadas + histórico)
  socket.on('dashboard:load', (cb) => {
    if (!allow(socket, 'profile', cb)) return;
    if (!requireAuth(cb)) return;
    const u = socket.data.user;
    cb?.({ ok: true, user: store.publicUser(u), history: store.getHistory(u.id), pausedSessions: store.listSessionsForProfile(u.id) });
  });

  // atualizar perfil (nome/avatar)
  socket.on('profile:update', ({ name, avatar } = {}, cb) => {
    if (!allow(socket, 'profile', cb)) return;
    if (!requireAuth(cb)) return;
    const cleanName = sanitizeText(name, 30);
    const updated = store.updateUserProfile(socket.data.user.id, {
      name: cleanName || undefined,
      avatar: validateAvatar(avatar),
    });
    socket.data.user = updated;
    cb?.({ ok: true, user: store.publicUser(updated) });
  });

  // ----- Criar mesa -----
  socket.on('room:create', ({ config } = {}, cb) => {
    if (!allow(socket, 'room:create', cb)) return;
    if (!requireAuth(cb)) return;
    try {
      if (gm.rooms.size >= MAX_ROOMS) return cb?.({ ok: false, error: 'Servidor lotado. Tente mais tarde.' });
      const profile = authedProfile(socket);
      const room = gm.createRoom(socket.id, profile, validateConfig(config || {}));
      socket.join(room.code);
      cb?.({ ok: true, code: room.code, you: socket.id, role: 'dm', state: room.toState() });
      socket.emit('log:history', room.log);
      broadcastState(room);
    } catch (e) { console.error('room:create', e); cb?.({ ok: false, error: 'Erro ao criar a mesa.' }); }
  });

  // ----- Retomar sessão -----
  socket.on('room:resume', ({ code } = {}, cb) => {
    if (!allow(socket, 'room:resume', cb)) return;
    if (!requireAuth(cb)) return;
    const safeCode = validateRoomCode(code);
    if (!safeCode) return cb?.({ ok: false, error: 'Código inválido.' });
    try {
      const profile = authedProfile(socket);
      const result = gm.resumeRoom(socket.id, profile, safeCode);
      if (result.error) return cb?.({ ok: false, error: result.error });
      const room = result.room;
      socket.join(room.code);
      cb?.({ ok: true, code: room.code, you: socket.id, role: 'dm', state: room.toState() });
      socket.emit('log:history', room.log);
      emitRoom(room, 'system:message', 'O mestre retomou a sessão.');
      broadcastState(room);
    } catch (e) { console.error('room:resume', e); cb?.({ ok: false, error: 'Erro ao retomar.' }); }
  });

  // ----- Entrar na mesa (com trava de idade) -----
  socket.on('room:join', ({ code } = {}, cb) => {
    if (!allow(socket, 'room:join', cb)) return;
    if (!requireAuth(cb)) return;
    const safeCode = validateRoomCode(code);
    if (!safeCode) return cb?.({ ok: false, error: 'Código inválido. Use os 5 caracteres da mesa.' });
    try {
      const profile = authedProfile(socket);
      const peek = gm.getRoom(safeCode);
      if (peek && peek.config.adult && !profile.isAdult) {
        return cb?.({ ok: false, error: '🔞 Esta mesa é restrita a maiores de 18 anos.' });
      }
      const result = gm.joinRoom(socket.id, safeCode, profile);
      if (result.error) return cb?.({ ok: false, error: result.error });
      const { room, member } = result;
      socket.join(room.code);
      cb?.({ ok: true, code: room.code, you: socket.id, role: 'player', state: room.toState(), characterId: member.characterId });
      socket.emit('log:history', room.log);
      pushLog(room, room.addSystem(`${member.name} entrou na mesa.`));
      broadcastState(room);
    } catch (e) { console.error('room:join', e); cb?.({ ok: false, error: 'Erro ao entrar.' }); }
  });

  // ----- Configuração da mesa -----
  socket.on('room:config', (partial, cb) => {
    if (!allow(socket, 'room:config', cb)) return;
    const room = gm.getRoomBySocket(socket.id);
    if (!room) return cb?.({ ok: false });
    if (!room.isDM(socket.id)) return cb?.({ ok: false, error: 'Apenas o mestre configura.' });
    room.updateConfig(socket.id, validateConfig(partial || {}, { partial: true }));
    broadcastState(room); autosave(room);
    cb?.({ ok: true });
  });

  // ----- Salvar personagem -----
  socket.on('character:save', ({ raw, targetCharId } = {}, cb) => {
    if (!allow(socket, 'character:save', cb)) return;
    const room = gm.getRoomBySocket(socket.id);
    if (!room) return cb?.({ ok: false, error: 'Mesa não encontrada.' });
    try {
      const cleanRaw = buildCharacterRaw(raw || {});
      const tid = cleanCharId(targetCharId);
      const result = room.upsertCharacter(socket.id, cleanRaw, tid);
      if (result.error) return cb?.({ ok: false, error: result.error });
      const member = room.getMember(socket.id);
      const isNew = !tid;
      if (isNew && socket.data.user?.id && !room.isDM(socket.id)) store.bumpStat(socket.data.user.id, 'charactersCreated');
      cb?.({ ok: true, character: result.character, characterId: result.characterId });
      pushLog(room, room.addSystem(
        `${member.name} ${isNew ? 'criou' : 'atualizou'} ${result.character.name} (${result.character.raceName} ${result.character.className} Nv.${result.character.level}).`
      ));
      broadcastState(room); autosave(room);
    } catch (e) { console.error('character:save', e); cb?.({ ok: false, error: 'Erro ao salvar a ficha.' }); }
  });

  // ----- Prévia -----
  socket.on('character:preview', (raw, cb) => {
    if (!allow(socket, 'character:preview', cb)) return;
    try { cb?.({ ok: true, character: computeCharacter(buildCharacterRaw(raw || {})) }); }
    catch (e) { cb?.({ ok: false, error: 'Erro ao calcular a ficha.' }); }
  });

  // ----- Dados brutos (edição) -----
  socket.on('character:raw', ({ characterId } = {}, cb) => {
    if (!allow(socket, 'character:raw', cb)) return;
    const room = gm.getRoomBySocket(socket.id);
    if (!room) return cb?.({ ok: false });
    const cid = cleanCharId(characterId);
    const raw = cid && room.getRaw(cid);
    if (!raw) return cb?.({ ok: false, error: 'Ficha não encontrada.' });
    const member = room.getMember(socket.id);
    if (!room.isDM(socket.id) && raw.ownerProfileId !== member?.profileId) {
      return cb?.({ ok: false, error: 'Sem permissão para editar esta ficha.' });
    }
    cb?.({ ok: true, raw: { ...raw, id: cid } });
  });

  // ----- Apagar -----
  socket.on('character:delete', ({ characterId } = {}, cb) => {
    if (!allow(socket, 'character:delete', cb)) return;
    const room = gm.getRoomBySocket(socket.id);
    if (!room) return cb?.({ ok: false });
    const cid = cleanCharId(characterId);
    if (!cid) return cb?.({ ok: false });
    const ok = room.deleteCharacter(socket.id, cid);
    if (ok) { broadcastState(room); autosave(room); }
    cb?.({ ok });
  });

  // ----- Rolagens -----
  socket.on('roll:freeform', ({ expression, label } = {}, cb) => {
    if (!allow(socket, 'roll', cb)) return;
    const room = gm.getRoomBySocket(socket.id);
    if (!room) return cb?.({ ok: false });
    const expr = sanitizeExpression(expression);
    if (!expr) return cb?.({ ok: false, error: 'Expressão inválida.' });
    const entry = room.rollFreeform(socket.id, expr, sanitizeLabel(label));
    if (!entry) return cb?.({ ok: false });
    if (entry.error) return cb?.({ ok: false, error: entry.error });
    pushLog(room, entry); cb?.({ ok: true, entry });
  });

  socket.on('roll:check', (data = {}, cb) => {
    if (!allow(socket, 'roll', cb)) return;
    const room = gm.getRoomBySocket(socket.id);
    if (!room) return cb?.({ ok: false });
    const mode = ['normal', 'advantage', 'disadvantage'].includes(data.mode) ? data.mode : 'normal';
    const entry = room.rollCheck(socket.id, { modifier: clampInt(data.modifier, -30, 30, 0), mode, label: sanitizeLabel(data.label) || 'Teste' });
    if (!entry) return cb?.({ ok: false });
    if (entry.error) return cb?.({ ok: false, error: entry.error });
    pushLog(room, entry); cb?.({ ok: true, entry });
  });

  // ----- Chat -----
  socket.on('chat:send', (text) => {
    if (!allow(socket, 'chat')) return;
    const room = gm.getRoomBySocket(socket.id);
    if (!room) return;
    const clean = sanitizeChat(text);
    if (clean) pushLog(room, room.addChat(socket.id, clean));
  });

  // ----- Cena -----
  socket.on('scene:set', (text, cb) => {
    if (!allow(socket, 'scene', cb)) return;
    const room = gm.getRoomBySocket(socket.id);
    if (!room || !room.isDM(socket.id)) return cb?.({ ok: false });
    room.setScene(socket.id, sanitizeText(text, LIMITS.SCENE, { newlines: true }));
    broadcastState(room); autosave(room);
    cb?.({ ok: true });
  });

  // ----- Pausar -----
  socket.on('session:pause', (cb) => {
    if (!allow(socket, 'room:config', cb)) return;
    const room = gm.getRoomBySocket(socket.id);
    if (!room || !room.isDM(socket.id)) return cb?.({ ok: false });
    emitRoom(room, 'session:paused', { name: room.name });
    gm.pauseRoom(room.code);
    cb?.({ ok: true });
  });

  socket.on('room:leave', () => handleLeave(socket));
  socket.on('disconnect', () => {
    handleLeave(socket);
    rl.cleanup(socket.id);
    const n = (ipConns.get(ip) || 1) - 1;
    if (n <= 0) ipConns.delete(ip); else ipConns.set(ip, n);
  });
});

function handleLeave(socket) {
  const room = gm.getRoomBySocket(socket.id);
  if (!room) return;
  const name = room.getMember(socket.id)?.name;
  const result = gm.leave(socket.id);
  if (!result || result.deleted || !result.room) return;
  const r = result.room;
  if (name) pushLog(r, r.addSystem(`${name} saiu da mesa.`));
  if (result.wasDM) pushLog(r, r.addSystem('O mestre saiu. A sessão foi salva e pode ser retomada.'));
  broadcastState(r);
}

httpServer.listen(PORT, () => {
  console.log(`🐉 Távola RPG rodando em http://localhost:${PORT}  ·  e-mail: ${mailerMode()}`);
});
