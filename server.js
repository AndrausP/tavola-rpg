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

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' }, maxHttpBufferSize: 2e6 });
const PORT = process.env.PORT || 3000;
const gm = new GameManager();

app.use(express.static(join(__dirname, 'public')));
app.get('/api/srd', (_req, res) => res.json({ ...SRD, quickDice: QUICK_DICE }));
app.get('/api/meta', (_req, res) => res.json({ stats: gm.stats }));
app.get('/api/health', (_req, res) => res.json({ ok: true, ...gm.stats }));

// ---------- Helpers ----------
const emitRoom = (room, ev, payload) => io.to(room.code).emit(ev, payload);
const broadcastState = (room) => emitRoom(room, 'room:state', room.toState());
function pushLog(room, entry) {
  if (entry) emitRoom(room, 'log:entry', entry);
}
function autosave(room) { if (room) gm.checkpoint(room.code); }

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
io.on('connection', (socket) => {
  socket.data.profile = null;

  socket.on('profile:sync', (profile) => {
    if (!profile?.id) return;
    socket.data.profile = sendProfileData(socket, profile);
  });

  // ----- Criar mesa (mestre) -----
  socket.on('room:create', ({ profile, config } = {}, cb) => {
    try {
      const p = store.upsertProfile(profile);
      socket.data.profile = p;
      const room = gm.createRoom(socket.id, p, config || {});
      socket.join(room.code);
      cb?.({ ok: true, code: room.code, you: socket.id, role: 'dm', state: room.toState() });
      socket.emit('log:history', room.log);
      broadcastState(room);
    } catch (e) {
      console.error(e);
      cb?.({ ok: false, error: 'Erro ao criar a mesa.' });
    }
  });

  // ----- Retomar sessão pausada (mestre) -----
  socket.on('room:resume', ({ profile, code } = {}, cb) => {
    const p = store.upsertProfile(profile);
    socket.data.profile = p;
    const result = gm.resumeRoom(socket.id, p, code);
    if (result.error) return cb?.({ ok: false, error: result.error });
    const room = result.room;
    socket.join(room.code);
    cb?.({ ok: true, code: room.code, you: socket.id, role: 'dm', state: room.toState() });
    socket.emit('log:history', room.log);
    emitRoom(room, 'system:message', `O mestre retomou a sessão.`);
    broadcastState(room);
  });

  // ----- Entrar na mesa (jogador) -----
  socket.on('room:join', ({ code, profile } = {}, cb) => {
    const p = store.upsertProfile(profile);
    socket.data.profile = p;
    const result = gm.joinRoom(socket.id, code, p);
    if (result.error) return cb?.({ ok: false, error: result.error });
    const { room, member } = result;
    socket.join(room.code);
    cb?.({
      ok: true, code: room.code, you: socket.id, role: 'player',
      state: room.toState(), characterId: member.characterId,
    });
    socket.emit('log:history', room.log);
    pushLog(room, room.addSystem(`${member.name} entrou na mesa.`));
    broadcastState(room);
  });

  // ----- Configuração da mesa (mestre) -----
  socket.on('room:config', (partial, cb) => {
    const room = gm.getRoomBySocket(socket.id);
    if (!room) return cb?.({ ok: false });
    if (!room.isDM(socket.id)) return cb?.({ ok: false, error: 'Apenas o mestre configura.' });
    room.updateConfig(socket.id, partial || {});
    broadcastState(room);
    autosave(room);
    cb?.({ ok: true });
  });

  // ----- Salvar/atualizar personagem -----
  socket.on('character:save', ({ raw, targetCharId } = {}, cb) => {
    const room = gm.getRoomBySocket(socket.id);
    if (!room) return cb?.({ ok: false, error: 'Mesa não encontrada.' });
    const result = room.upsertCharacter(socket.id, raw || {}, targetCharId);
    if (result.error) return cb?.({ ok: false, error: result.error });

    const member = room.getMember(socket.id);
    const isNew = !targetCharId;
    if (isNew && socket.data.profile?.id && !room.isDM(socket.id)) {
      store.bumpStat(socket.data.profile.id, 'charactersCreated');
    }
    cb?.({ ok: true, character: result.character, characterId: result.characterId });
    pushLog(room, room.addSystem(
      `${member.name} ${isNew ? 'criou' : 'atualizou'} ${result.character.name} (${result.character.raceName} ${result.character.className} Nv.${result.character.level}).`
    ));
    broadcastState(room);
    autosave(room);
  });

  // ----- Buscar dados brutos da ficha (para edição) -----
  socket.on('character:raw', ({ characterId } = {}, cb) => {
    const room = gm.getRoomBySocket(socket.id);
    if (!room) return cb?.({ ok: false });
    const raw = room.getRaw(characterId);
    if (!raw) return cb?.({ ok: false, error: 'Ficha não encontrada.' });
    const member = room.getMember(socket.id);
    if (!room.isDM(socket.id) && raw.ownerProfileId !== member?.profileId) {
      return cb?.({ ok: false, error: 'Sem permissão para editar esta ficha.' });
    }
    cb?.({ ok: true, raw: { ...raw, id: characterId } });
  });

  // ----- Apagar personagem -----
  socket.on('character:delete', ({ characterId } = {}, cb) => {
    const room = gm.getRoomBySocket(socket.id);
    if (!room) return cb?.({ ok: false });
    const ok = room.deleteCharacter(socket.id, characterId);
    if (ok) { broadcastState(room); autosave(room); }
    cb?.({ ok });
  });

  // ----- Rolagem livre (ex.: 2d6+3) -----
  socket.on('roll:freeform', ({ expression, label } = {}, cb) => {
    const room = gm.getRoomBySocket(socket.id);
    if (!room) return cb?.({ ok: false });
    const entry = room.rollFreeform(socket.id, expression, label);
    if (!entry) return cb?.({ ok: false });
    if (entry.error) return cb?.({ ok: false, error: entry.error });
    pushLog(room, entry);
    cb?.({ ok: true, entry });
  });

  // ----- Rolagem de teste (perícia/atributo/save) -----
  socket.on('roll:check', (data, cb) => {
    const room = gm.getRoomBySocket(socket.id);
    if (!room) return cb?.({ ok: false });
    const entry = room.rollCheck(socket.id, data || {});
    if (!entry) return cb?.({ ok: false });
    if (entry.error) return cb?.({ ok: false, error: entry.error });
    pushLog(room, entry);
    cb?.({ ok: true, entry });
  });

  // ----- Prévia de ficha (calcula sem salvar) -----
  socket.on('character:preview', (raw, cb) => {
    try {
      const computed = computeCharacter(raw || {});
      cb?.({ ok: true, character: computed });
    } catch (e) {
      cb?.({ ok: false, error: 'Erro ao calcular a ficha.' });
    }
  });

  // ----- Chat -----
  socket.on('chat:send', (text) => {
    const room = gm.getRoomBySocket(socket.id);
    if (!room) return;
    pushLog(room, room.addChat(socket.id, text));
  });

  // ----- Cena (mestre) -----
  socket.on('scene:set', (text, cb) => {
    const room = gm.getRoomBySocket(socket.id);
    if (!room || !room.isDM(socket.id)) return cb?.({ ok: false });
    room.setScene(socket.id, text);
    broadcastState(room);
    autosave(room);
    cb?.({ ok: true });
  });

  // ----- Pausar sessão (mestre) -----
  socket.on('session:pause', (cb) => {
    const room = gm.getRoomBySocket(socket.id);
    if (!room || !room.isDM(socket.id)) return cb?.({ ok: false });
    emitRoom(room, 'session:paused', { name: room.name });
    gm.pauseRoom(room.code);
    cb?.({ ok: true });
  });

  socket.on('room:leave', () => handleLeave(socket));
  socket.on('disconnect', () => handleLeave(socket));
});

function handleLeave(socket) {
  const room = gm.getRoomBySocket(socket.id);
  if (!room) return;
  const name = room.getMember(socket.id)?.name;
  const result = gm.leave(socket.id);
  if (!result) return;
  if (result.deleted || !result.room) return;
  const r = result.room;
  if (name) pushLog(r, r.addSystem(`${name} saiu da mesa.`));
  if (result.wasDM) {
    pushLog(r, r.addSystem('O mestre saiu. A sessão foi salva e pode ser retomada.'));
  }
  broadcastState(r);
}

httpServer.listen(PORT, () => {
  console.log(`🐉 Távola RPG rodando em http://localhost:${PORT}`);
});
