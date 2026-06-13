// src/store.js
// Persistência simples baseada em arquivo JSON (sem dependências externas).
// Guarda perfis, histórico de partidas e sessões pausadas para retomar depois.

import { promises as fs } from 'fs';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'db.json');

const EMPTY = { profiles: {}, sessions: {}, history: {} };

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
      await fs.rename(tmp, DB_PATH); // escrita atômica
    } catch (e) {
      console.error('Falha ao salvar DB:', e.message);
      this._dirty = true;
    }
  }

  // ---------- Perfis ----------
  getProfile(id) {
    return this.db.profiles[id] || null;
  }

  upsertProfile(profile) {
    if (!profile?.id) return null;
    const existing = this.db.profiles[profile.id] || {
      id: profile.id,
      createdAt: Date.now(),
      stats: { sessionsPlayed: 0, sessionsMastered: 0, charactersCreated: 0, totalRolls: 0 },
    };
    this.db.profiles[profile.id] = {
      ...existing,
      name: (profile.name || existing.name || 'Aventureiro').slice(0, 30),
      avatar: profile.avatar || existing.avatar || '🧙',
    };
    this._scheduleWrite();
    return this.db.profiles[profile.id];
  }

  bumpStat(profileId, stat, by = 1) {
    const p = this.db.profiles[profileId];
    if (!p) return;
    p.stats = p.stats || {};
    p.stats[stat] = (p.stats[stat] || 0) + by;
    this._scheduleWrite();
  }

  // ---------- Sessões pausadas ----------
  saveSession(code, snapshot) {
    this.db.sessions[code] = { ...snapshot, code, savedAt: Date.now() };
    this._scheduleWrite();
  }

  getSession(code) {
    return this.db.sessions[code] || null;
  }

  deleteSession(code) {
    delete this.db.sessions[code];
    this._scheduleWrite();
  }

  /** Sessões em que o perfil é mestre ou participou (para a lista de "pausadas"). */
  listSessionsForProfile(profileId) {
    return Object.values(this.db.sessions)
      .filter((s) => s.dmProfileId === profileId
        || (s.memberProfileIds || []).includes(profileId))
      .map((s) => ({
        code: s.code,
        name: s.name,
        isDM: s.dmProfileId === profileId,
        playerCount: (s.characters || []).length,
        savedAt: s.savedAt,
        scene: s.scene || '',
      }))
      .sort((a, b) => b.savedAt - a.savedAt);
  }

  // ---------- Histórico ----------
  addHistory(profileId, entry) {
    if (!profileId) return;
    if (!this.db.history[profileId]) this.db.history[profileId] = [];
    this.db.history[profileId].unshift({ ...entry, at: Date.now() });
    this.db.history[profileId] = this.db.history[profileId].slice(0, 50);
    this._scheduleWrite();
  }

  getHistory(profileId) {
    return this.db.history[profileId] || [];
  }
}

export const store = new Store();
