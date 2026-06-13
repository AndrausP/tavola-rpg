// src/GameManager.js
import { Room } from './Room.js';
import { store } from './store.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class GameManager {
  constructor() {
    /** @type {Map<string, Room>} code -> Room ativa */
    this.rooms = new Map();
    /** @type {Map<string, string>} socketId -> code */
    this.socketRoom = new Map();
  }

  generateCode() {
    let code;
    do {
      code = Array.from({ length: 5 }, () =>
        CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    } while (this.rooms.has(code) || store.getSession(code));
    return code;
  }

  createRoom(dmSocketId, dmProfile, config) {
    const code = this.generateCode();
    const room = new Room(code, dmSocketId, dmProfile, config);
    room.addMember(dmSocketId, dmProfile, 'dm');
    this.rooms.set(code, room);
    this.socketRoom.set(dmSocketId, code);
    if (dmProfile?.id) store.bumpStat(dmProfile.id, 'sessionsMastered');
    return room;
  }

  /** Retoma uma sessão pausada (apenas o mestre dono). */
  resumeRoom(dmSocketId, dmProfile, code) {
    code = (code || '').toUpperCase();
    if (this.rooms.has(code)) return { room: this.rooms.get(code) }; // já ativa
    const snap = store.getSession(code);
    if (!snap) return { error: 'Sessão não encontrada.' };
    if (snap.dmProfileId && dmProfile?.id && snap.dmProfileId !== dmProfile.id) {
      return { error: 'Apenas o mestre pode retomar esta sessão.' };
    }
    const room = Room.restore(code, snap, dmSocketId, dmProfile);
    room.addMember(dmSocketId, dmProfile, 'dm');
    this.rooms.set(code, room);
    this.socketRoom.set(dmSocketId, code);
    return { room };
  }

  joinRoom(socketId, code, profile) {
    code = (code || '').toUpperCase().trim();
    let room = this.rooms.get(code);
    // se não está ativa mas existe sessão salva, jogador aguarda o mestre retomar
    if (!room) {
      if (store.getSession(code)) {
        return { error: 'A mesa está pausada. Aguarde o mestre retomá-la.' };
      }
      return { error: 'Mesa não encontrada. Confira o código.' };
    }
    const players = room.memberList.filter((m) => m.role === 'player');
    const known = profile?.id && room.memberList.some((m) => m.profileId === profile.id);
    if (!known && players.length >= room.config.maxPlayers) {
      return { error: 'A mesa está cheia.' };
    }
    const member = room.addMember(socketId, profile, 'player');
    this.socketRoom.set(socketId, code);
    if (profile?.id) store.bumpStat(profile.id, 'sessionsPlayed');
    return { room, member };
  }

  getRoom(code) { return this.rooms.get((code || '').toUpperCase()); }
  getRoomBySocket(socketId) {
    const code = this.socketRoom.get(socketId);
    return code ? this.rooms.get(code) : null;
  }

  /** Pausa: salva snapshot e mantém ou remove da memória. */
  pauseRoom(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    room.state = 'paused';
    store.saveSession(code, room.snapshot());
  }

  /** Auto-salva sem mudar estado (checkpoint). */
  checkpoint(code) {
    const room = this.rooms.get(code);
    if (room) store.saveSession(code, room.snapshot());
  }

  leave(socketId) {
    const code = this.socketRoom.get(socketId);
    if (!code) return null;
    const room = this.rooms.get(code);
    this.socketRoom.delete(socketId);
    if (!room) return null;
    const member = room.removeMember(socketId);
    const wasDM = member?.role === 'dm';

    if (room.isEmpty()) {
      // salva e descarrega da memória (vira sessão pausada se tinha personagens)
      if (room.characters.size > 0 || room.log.length > 0) {
        room.state = 'paused';
        store.saveSession(code, room.snapshot());
      }
      this.rooms.delete(code);
      return { room: null, code, deleted: true, wasDM, member };
    }
    return { room, code, deleted: false, wasDM, member };
  }

  get stats() {
    return { rooms: this.rooms.size, players: this.socketRoom.size };
  }
}
