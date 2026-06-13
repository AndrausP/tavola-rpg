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
  validateProfile, validateConfig, buildCharacterRaw, validateRoomCode,
  sanitizeLabel, sanitizeChat, sanitizeExpression, sanitizeText, clampInt, LIMITS,
} from './src/validate.js';
import { createRateLimiter, RATE } from './src/rateLimiter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const MAX_ROOMS = parseInt(process.env.MAX_ROOMS || '2000', 10);
const MAX_CONN_PER_IP = parseInt(process.env.MAX_CONN_PER_IP || '60', 10);
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : null;

// não derruba o processo por um erro inesperado (proteção contra DoS por exceção)
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

const app = express();
app.disable('x-powered-by');

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

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: ALLOWED_ORIGINS || true, methods: ['GET', 'POST'], credentials: false },
  maxHttpBufferSize: 1e6, // 1 MB por mensagem (limita payloads abusivos)
  pingTimeout: 20000,
});

const gm = new GameManager();
const rl = createRateLimiter();

// ---------- Estáticos + API ----------
app.use(express.static(join(__dirname, 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=300'),
}));
app.get('/api/srd', (_req, res) => res.json({ ...SRD, quickDice: QUICK_DICE }));
app.get('/api/meta', (_req, res) => res.json({ stats: gm.stats }));
app.get('/api/health', (_req, res) => res.json({ ok: true, ...gm.stats }));

// ---------- Helpers ----------
const emitRoom = (room, ev, payload) => io.to(room.code).emit(ev, payload);
const broadcastState = (room) => emitRoom(room, 'room:state', room.toState());
const pushLog = (room, entry) => { if (entry) emitRoom(room, 'log:entry', entry); };
const autosave = (room) => { if (room) gm.checkpoint(room.code); };

/** Verifica rate limit (categoria + global). Retorna true se permitido. */
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

function cleanCharId(v) {
  return (typeof v === 'string' && /^[\w-]{1,40}$/.test(v)) ? v : null;
}

function sendProfileData(socket, profile) {
  const p = store.upsertProfile(profile);
  socket.emit('profile:data', {
    profile: p,
    history: store.getHistory(p.id),
    pausedSessions: store.listSessionsForProfile(p.id),
  });
  return p;
}

// ---------- Socket.IO ----------
const ipConns = new Map();

io.on('connection', (socket) => {
  // limite de conexões por IP (melhor-esforço)
  const ip = socket.handshake.address || 'unknown';
  ipConns.set(ip, (ipConns.get(ip) || 0) + 1);
  if (ipConns.get(ip) > MAX_CONN_PER_IP) {
    socket.emit('security:notice', 'Muitas conexões deste dispositivo.');
    ipConns.set(ip, ipConns.get(ip) - 1);
    socket.disconnect(true);
    return;
  }
  socket.data.profile = null;

  socket.on('profile:sync', (profile) => {
    if (!allow(socket, 'profile')) return;
    try { socket.data.profile = sendProfileData(socket, validateProfile(profile)); } catch (_) {}
  });

  // ----- Criar mesa -----
  socket.on('room:create', ({ profile, config } = {}, cb) => {
    if (!allow(socket, 'room:create', cb)) return;
    try {
      if (gm.rooms.size >= MAX_ROOMS) return cb?.({ ok: false, error: 'Servidor lotado. Tente mais tarde.' });
      const p = store.upsertProfile(validateProfile(profile));
      socket.data.profile = p;
      const room = gm.createRoom(socket.id, p, validateConfig(config || {}));
      socket.join(room.code);
      cb?.({ ok: true, code: room.code, you: socket.id, role: 'dm', state: room.toState() });
      socket.emit('log:history', room.log);
      broadcastState(room);
    } catch (e) { console.error('room:create', e); cb?.({ ok: false, error: 'Erro ao criar a mesa.' }); }
  });

  // ----- Retomar sessão -----
  socket.on('room:resume', ({ profile, code } = {}, cb) => {
    if (!allow(socket, 'room:resume', cb)) return;
    const safeCode = validateRoomCode(code);
    if (!safeCode) return cb?.({ ok: false, error: 'Código inválido.' });
    try {
      const p = store.upsertProfile(validateProfile(profile));
      socket.data.profile = p;
      const result = gm.resumeRoom(socket.id, p, safeCode);
      if (result.error) return cb?.({ ok: false, error: result.error });
      const room = result.room;
      socket.join(room.code);
      cb?.({ ok: true, code: room.code, you: socket.id, role: 'dm', state: room.toState() });
      socket.emit('log:history', room.log);
      emitRoom(room, 'system:message', 'O mestre retomou a sessão.');
      broadcastState(room);
    } catch (e) { console.error('room:resume', e); cb?.({ ok: false, error: 'Erro ao retomar.' }); }
  });

  // ----- Entrar na mesa -----
  socket.on('room:join', ({ code, profile } = {}, cb) => {
    if (!allow(socket, 'room:join', cb)) return;
    const safeCode = validateRoomCode(code);
    if (!safeCode) return cb?.({ ok: false, error: 'Código inválido. Use os 5 caracteres da mesa.' });
    try {
      const p = store.upsertProfile(validateProfile(profile));
      socket.data.profile = p;
      const result = gm.joinRoom(socket.id, safeCode, p);
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
      if (isNew && socket.data.profile?.id && !room.isDM(socket.id)) {
        store.bumpStat(socket.data.profile.id, 'charactersCreated');
      }
      cb?.({ ok: true, character: result.character, characterId: result.characterId });
      pushLog(room, room.addSystem(
        `${member.name} ${isNew ? 'criou' : 'atualizou'} ${result.character.name} (${result.character.raceName} ${result.character.className} Nv.${result.character.level}).`
      ));
      broadcastState(room); autosave(room);
    } catch (e) { console.error('character:save', e); cb?.({ ok: false, error: 'Erro ao salvar a ficha.' }); }
  });

  // ----- Prévia de ficha (sem salvar) -----
  socket.on('character:preview', (raw, cb) => {
    if (!allow(socket, 'character:preview', cb)) return;
    try {
      const computed = computeCharacter(buildCharacterRaw(raw || {}));
      cb?.({ ok: true, character: computed });
    } catch (e) { cb?.({ ok: false, error: 'Erro ao calcular a ficha.' }); }
  });

  // ----- Buscar dados brutos (edição) -----
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

  // ----- Apagar personagem -----
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

  // ----- Rolagem livre -----
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

  // ----- Rolagem de teste -----
  socket.on('roll:check', (data = {}, cb) => {
    if (!allow(socket, 'roll', cb)) return;
    const room = gm.getRoomBySocket(socket.id);
    if (!room) return cb?.({ ok: false });
    const mode = ['normal', 'advantage', 'disadvantage'].includes(data.mode) ? data.mode : 'normal';
    const entry = room.rollCheck(socket.id, {
      modifier: clampInt(data.modifier, -30, 30, 0),
      mode,
      label: sanitizeLabel(data.label) || 'Teste',
    });
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
    if (!clean) return;
    pushLog(room, room.addChat(socket.id, clean));
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
  console.log(`🐉 Távola RPG rodando em http://localhost:${PORT}`);
});
