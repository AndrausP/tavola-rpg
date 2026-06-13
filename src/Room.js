// src/Room.js
// Mesa de RPG (sessão): membros, personagens, log (chat + dados), cena e persistência.

import { computeCharacter } from './Character.js';
import { rollExpression, rollD20 } from './dice.js';
import { LIMITS } from './validate.js';

const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const PLAYER_COLORS = [
  '#b5482e', '#2e6f9e', '#3d8b5f', '#8a5fb5', '#c2872b',
  '#a83a5b', '#4a7a7a', '#7a6a3a', '#9e4a2e', '#5f5fb5',
];

export class Room {
  constructor(code, dmSocketId, dmProfile, config = {}) {
    this.code = code;
    this.dmId = dmSocketId;            // socket atual do mestre
    this.dmProfileId = dmProfile?.id || null;
    this.dmName = dmProfile?.name || 'Mestre';
    this.name = (config.name || 'Nova Campanha').slice(0, 60);
    this.scene = (config.scene || '').slice(0, 4000);
    this.state = 'lobby';              // lobby | active | paused

    this.config = {
      levelStart: clampInt(config.levelStart || 1, 1, 20),
      abilityMethod: config.abilityMethod || 'standard_array', // standard_array | point_buy | manual
      maxPlayers: clampInt(config.maxPlayers || 6, 1, 10),
      allowPlayerRolls: config.allowPlayerRolls !== false,
      allowedRaces: Array.isArray(config.allowedRaces) ? config.allowedRaces : null, // null = todas
      allowedClasses: Array.isArray(config.allowedClasses) ? config.allowedClasses : null,
      dmCanEdit: config.dmCanEdit !== false,
    };

    /** @type {Map<string, Member>} socketId -> member */
    this.members = new Map();
    /** @type {Map<string, object>} characterId -> ficha calculada (+ raw guardado) */
    this.characters = new Map();
    /** raw por characterId (para recálculo/edição) */
    this.rawChars = new Map();

    this.log = [];
    this._colorIdx = 0;
  }

  // ---------- Membros ----------
  addMember(socketId, profile, role) {
    const isDM = role === 'dm';
    const color = isDM ? '#d4af37' : PLAYER_COLORS[this._colorIdx++ % PLAYER_COLORS.length];
    const member = {
      socketId,
      profileId: profile?.id || null,
      name: (profile?.name || (isDM ? 'Mestre' : 'Jogador')).slice(0, 30),
      avatar: profile?.avatar || (isDM ? '👑' : '🧙'),
      role: isDM ? 'dm' : 'player',
      color,
      characterId: null,
      connected: true,
    };
    if (isDM) { this.dmId = socketId; this.dmProfileId = member.profileId; }
    // re-vincula personagem existente do mesmo perfil (reconexão / retomar)
    if (member.profileId) {
      for (const [cid, raw] of this.rawChars) {
        if (raw.ownerProfileId === member.profileId && !isDM) {
          member.characterId = cid;
          break;
        }
      }
    }
    this.members.set(socketId, member);
    return member;
  }

  removeMember(socketId) {
    const m = this.members.get(socketId);
    this.members.delete(socketId);
    return m;
  }

  getMember(socketId) { return this.members.get(socketId); }
  isDM(socketId) { return this.dmId === socketId; }
  get memberList() { return [...this.members.values()]; }

  // ---------- Personagens ----------
  /** Cria ou atualiza um personagem. Jogador edita o próprio; DM edita qualquer um. */
  upsertCharacter(socketId, rawChar, targetCharId = null) {
    const member = this.members.get(socketId);
    if (!member) return { error: 'Membro não encontrado.' };
    if (!rawChar || typeof rawChar !== 'object') rawChar = {};

    // O cliente NUNCA define o dono, o id ou chaves perigosas — só o servidor.
    delete rawChar.ownerProfileId;
    delete rawChar.id;
    delete rawChar.__proto__;
    delete rawChar.constructor;
    delete rawChar.prototype;

    const isDM = this.isDM(socketId);
    let cid = targetCharId || member.characterId;

    if (cid) {
      // editar existente — checa permissão
      const existingRaw = this.rawChars.get(cid);
      if (!existingRaw) cid = null;
      else {
        const owner = existingRaw.ownerProfileId;
        if (!isDM && owner !== member.profileId) {
          return { error: 'Você só pode editar seu próprio personagem.' };
        }
        if (isDM && !this.config.dmCanEdit && owner !== member.profileId) {
          return { error: 'Edição pelo mestre desativada.' };
        }
      }
    }

    if (!cid) {
      // limite de personagens por sala (proteção contra exaustão de recursos)
      if (this.characters.size >= LIMITS.MAX_CHARS_PER_ROOM) {
        return { error: 'Limite de personagens da mesa atingido.' };
      }
      cid = uid('char');
      if (!isDM) member.characterId = cid;
    }

    const prevRaw = this.rawChars.get(cid) || {};
    const merged = { ...prevRaw, ...rawChar };
    // dono é sempre derivado do servidor (nunca do cliente)
    merged.ownerProfileId = prevRaw.ownerProfileId || member.profileId;
    merged.color = merged.color || member.color;

    const computed = computeCharacter(merged);
    computed.id = cid;
    computed.ownerProfileId = merged.ownerProfileId;
    computed.isNPC = merged.isNPC || false;

    this.rawChars.set(cid, merged);
    this.characters.set(cid, computed);

    if (!isDM && !member.characterId) member.characterId = cid;

    return { character: computed, characterId: cid };
  }

  getCharacter(cid) { return this.characters.get(cid); }
  getRaw(cid) { return this.rawChars.get(cid); }

  deleteCharacter(socketId, cid) {
    if (!this.isDM(socketId)) {
      const m = this.members.get(socketId);
      const raw = this.rawChars.get(cid);
      if (!raw || raw.ownerProfileId !== m?.profileId) return false;
    }
    this.characters.delete(cid);
    this.rawChars.delete(cid);
    for (const m of this.members.values()) if (m.characterId === cid) m.characterId = null;
    return true;
  }

  // ---------- Rolagens ----------
  rollFreeform(socketId, expression, label = '') {
    const m = this.members.get(socketId);
    if (!m) return null;
    if (!this.isDM(socketId) && !this.config.allowPlayerRolls) {
      return { error: 'O mestre desativou rolagens dos jogadores.' };
    }
    const result = rollExpression(expression);
    if (!result.ok) return { error: result.error };
    return this._addRoll(m, { kind: 'freeform', label: label.slice(0, 40), result });
  }

  rollCheck(socketId, { skillKey, ability, label, modifier = 0, mode = 'normal' } = {}) {
    const m = this.members.get(socketId);
    if (!m) return null;
    if (!this.isDM(socketId) && !this.config.allowPlayerRolls) {
      return { error: 'O mestre desativou rolagens dos jogadores.' };
    }
    const result = rollD20(modifier, mode);
    return this._addRoll(m, {
      kind: 'check', label: (label || 'Teste').slice(0, 40), skillKey, ability, result,
    });
  }

  _addRoll(member, data) {
    const entry = {
      id: uid('log'), type: 'roll', ts: Date.now(),
      authorId: member.socketId, author: member.name,
      avatar: member.avatar, color: member.color,
      ...data,
    };
    this.log.push(entry);
    this._trimLog();
    return entry;
  }

  // ---------- Chat ----------
  addChat(socketId, text) {
    const m = this.members.get(socketId);
    if (!m || !text?.toString().trim()) return null;
    const entry = {
      id: uid('log'), type: 'chat', ts: Date.now(),
      authorId: socketId, author: m.name, avatar: m.avatar, color: m.color,
      text: text.toString().slice(0, 500),
      inCharacter: false,
    };
    this.log.push(entry);
    this._trimLog();
    return entry;
  }

  addSystem(text) {
    const entry = { id: uid('log'), type: 'system', ts: Date.now(), text };
    this.log.push(entry);
    this._trimLog();
    return entry;
  }

  _trimLog() { if (this.log.length > 300) this.log = this.log.slice(-300); }

  // ---------- Cena / estado ----------
  setScene(socketId, text) {
    if (!this.isDM(socketId)) return false;
    this.scene = (text || '').slice(0, 4000);
    return true;
  }

  updateConfig(socketId, partial) {
    if (!this.isDM(socketId)) return false;
    const c = this.config;
    if (partial.name != null) this.name = partial.name.toString().slice(0, 60);
    if (partial.allowPlayerRolls != null) c.allowPlayerRolls = !!partial.allowPlayerRolls;
    if (partial.dmCanEdit != null) c.dmCanEdit = !!partial.dmCanEdit;
    if (partial.maxPlayers != null) c.maxPlayers = clampInt(partial.maxPlayers, 1, 10);
    if (partial.levelStart != null) c.levelStart = clampInt(partial.levelStart, 1, 20);
    if (partial.abilityMethod != null) c.abilityMethod = partial.abilityMethod;
    if ('allowedRaces' in partial) c.allowedRaces = partial.allowedRaces;
    if ('allowedClasses' in partial) c.allowedClasses = partial.allowedClasses;
    if (partial.scene != null) this.scene = partial.scene.toString().slice(0, 4000);
    return true;
  }

  // ---------- Persistência ----------
  snapshot() {
    return {
      name: this.name,
      scene: this.scene,
      config: this.config,
      dmProfileId: this.dmProfileId,
      dmName: this.dmName,
      memberProfileIds: this.memberList.map((m) => m.profileId).filter(Boolean),
      characters: [...this.rawChars.entries()].map(([id, raw]) => ({ id, raw })),
      log: this.log.slice(-100),
      state: this.state,
    };
  }

  static restore(code, snapshot, dmSocketId, dmProfile) {
    const room = new Room(code, dmSocketId, dmProfile || { id: snapshot.dmProfileId, name: snapshot.dmName }, {
      ...snapshot.config, name: snapshot.name, scene: snapshot.scene,
    });
    room.dmProfileId = snapshot.dmProfileId;
    room.dmName = snapshot.dmName || 'Mestre';
    room.state = 'active';
    for (const { id, raw } of (snapshot.characters || [])) {
      room.rawChars.set(id, raw);
      const computed = computeCharacter(raw);
      computed.id = id;
      computed.ownerProfileId = raw.ownerProfileId;
      computed.isNPC = raw.isNPC || false;
      room.characters.set(id, computed);
    }
    room.log = snapshot.log || [];
    return room;
  }

  // ---------- Serialização p/ cliente ----------
  toState() {
    return {
      code: this.code,
      name: this.name,
      scene: this.scene,
      state: this.state,
      dmId: this.dmId,
      dmName: this.dmName,
      config: this.config,
      members: this.memberList.map((m) => ({
        socketId: m.socketId, name: m.name, avatar: m.avatar,
        role: m.role, color: m.color, characterId: m.characterId,
        connected: m.connected,
      })),
      characters: [...this.characters.values()],
    };
  }

  isEmpty() { return this.members.size === 0; }
}

function clampInt(n, min, max) {
  n = parseInt(n, 10);
  if (Number.isNaN(n)) n = min;
  return Math.max(min, Math.min(max, n));
}
