// src/store.js
// Persistência em JSON (sem dependências externas): usuários, sessões de login,
// tokens de e-mail, sessões de jogo pausadas e histórico.
// Tokens são guardados SOMENTE como hash (um vazamento do arquivo não expõe tokens usáveis).

import { promises as fs } from 'fs';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';
import { sha256 } from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'db.json');

const EMPTY = { users: {}, emailIndex: {}, authSessions: {}, emailTokens: {}, sessions: {}, history: {} };

const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 dias
const EMAIL_TOKEN_TTL = 24 * 60 * 60 * 1000;   // 24 horas

class Store {
  constructor() {
    this.db = this._loadSync();
    this._writeTimer = null;
    this._dirty = false;
  }

  _loadSync() {
    try {
      if (existsSync(DB_PATH)) {
        const raw = readFileSync(DB_PATH, 'utf-8');
        return { ...EMPTY, ...JSON.parse(raw) };
      }
    } catch (e) {
      console.error('Falha ao carregar DB, iniciando vazio:', e.message);
    }
    return JSON.parse(JSON.stringify(EMPTY));
  }

  _scheduleWrite() {
    this._dirty = true;
    if (this._writeTimer) return;
    this._writeTimer = setTimeout(() => this._flush(), 800);
  }

  async _flush() {
    this._writeTimer = null;
    if (!this._dirty) return;
    this._dirty = false;
    try {
      await fs.mkdir(dirname(DB_PATH), { recursive: true });
      const tmp = DB_PATH + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(this.db));
      await fs.rename(tmp, DB_PATH);
    } catch (e) {
      console.error('Falha ao salvar DB:', e.message);
      this._dirty = true;
    }
  }

  // ================= USUÁRIOS =================
  findUserByEmail(emailLower) {
    const id = this.db.emailIndex[emailLower];
    return id ? this.db.users[id] || null : null;
  }

  getUser(id) { return this.db.users[id] || null; }

  createUser({ email, name, avatar, birthdate, salt, hash }) {
    const id = 'u_' + crypto.randomUUID();
    const user = {
      id,
      email,
      name,
      avatar: avatar || '🧙',
      birthdate,
      salt,
      hash,
      emailVerified: false,
      createdAt: Date.now(),
      stats: { sessionsPlayed: 0, sessionsMastered: 0, charactersCreated: 0 },
    };
    this.db.users[id] = user;
    this.db.emailIndex[email] = id;
    this._scheduleWrite();
    return user;
  }

  verifyUserEmail(id) {
    const u = this.db.users[id];
    if (u) { u.emailVerified = true; this._scheduleWrite(); }
    return u;
  }

  updateUserProfile(id, { name, avatar } = {}) {
    const u = this.db.users[id];
    if (!u) return null;
    if (name != null) u.name = name;
    if (avatar != null) u.avatar = avatar;
    this._scheduleWrite();
    return u;
  }

  bumpStat(userId, stat, by = 1) {
    const u = this.db.users[userId];
    if (!u) return;
    u.stats = u.stats || {};
    u.stats[stat] = (u.stats[stat] || 0) + by;
    this._scheduleWrite();
  }

  /** Dados públicos do usuário (nunca expõe hash/salt). */
  publicUser(u) {
    if (!u) return null;
    const age = ageFromBirthdate(u.birthdate);
    return {
      id: u.id, name: u.name, avatar: u.avatar, email: u.email,
      emailVerified: u.emailVerified, age, isAdult: age != null && age >= 18,
      stats: u.stats || {},
    };
  }

  // ================= SESSÕES DE LOGIN =================
  createAuthSession(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    this.db.authSessions[sha256(token)] = { userId, expiresAt: Date.now() + SESSION_TTL };
    this._scheduleWrite();
    return token;
  }

  getUserByToken(token) {
    if (!token) return null;
    const rec = this.db.authSessions[sha256(token)];
    if (!rec) return null;
    if (rec.expiresAt < Date.now()) {
      delete this.db.authSessions[sha256(token)];
      this._scheduleWrite();
      return null;
    }
    return this.getUser(rec.userId);
  }

  deleteAuthSession(token) {
    if (!token) return;
    delete this.db.authSessions[sha256(token)];
    this._scheduleWrite();
  }

  // ================= TOKENS DE E-MAIL =================
  createEmailToken(userId) {
    const token = crypto.randomBytes(24).toString('base64url');
    this.db.emailTokens[sha256(token)] = { userId, expiresAt: Date.now() + EMAIL_TOKEN_TTL };
    this._scheduleWrite();
    return token;
  }

  consumeEmailToken(token) {
    if (!token) return null;
    const key = sha256(token);
    const rec = this.db.emailTokens[key];
    if (!rec) return null;
    delete this.db.emailTokens[key];
    this._scheduleWrite();
    if (rec.expiresAt < Date.now()) return null;
    return rec.userId;
  }

  // ================= SESSÕES DE JOGO PAUSADAS =================
  saveSession(code, snapshot) {
    this.db.sessions[code] = { ...snapshot, code, savedAt: Date.now() };
    this._scheduleWrite();
  }
  getSession(code) { return this.db.sessions[code] || null; }
  deleteSession(code) { delete this.db.sessions[code]; this._scheduleWrite(); }

  listSessionsForProfile(profileId) {
    return Object.values(this.db.sessions)
      .filter((s) => s.dmProfileId === profileId || (s.memberProfileIds || []).includes(profileId))
      .map((s) => ({
        code: s.code, name: s.name, isDM: s.dmProfileId === profileId,
        playerCount: (s.characters || []).length, savedAt: s.savedAt, scene: s.scene || '',
      }))
      .sort((a, b) => b.savedAt - a.savedAt);
  }

  // ================= HISTÓRICO =================
  addHistory(profileId, entry) {
    if (!profileId) return;
    if (!this.db.history[profileId]) this.db.history[profileId] = [];
    this.db.history[profileId].unshift({ ...entry, at: Date.now() });
    this.db.history[profileId] = this.db.history[profileId].slice(0, 50);
    this._scheduleWrite();
  }
  getHistory(profileId) { return this.db.history[profileId] || []; }

  // ================= MANUTENÇÃO =================
  prune() {
    const now = Date.now();
    let changed = false;
    for (const k of Object.keys(this.db.authSessions)) {
      if (this.db.authSessions[k].expiresAt < now) { delete this.db.authSessions[k]; changed = true; }
    }
    for (const k of Object.keys(this.db.emailTokens)) {
      if (this.db.emailTokens[k].expiresAt < now) { delete this.db.emailTokens[k]; changed = true; }
    }
    if (changed) this._scheduleWrite();
  }
}

function ageFromBirthdate(b) {
  if (typeof b !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  const d = new Date(b + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

export const store = new Store();
