// public/js/profile.js
// Perfil local do usuário: id estável (localStorage), nome e avatar.

const KEY = 'tavola:profile';

const Profile = {
  data: null,

  load() {
    if (this.data) return this.data;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = JSON.parse(raw);
    } catch (_) {}
    if (!this.data || !this.data.id) {
      this.data = { id: this._uuid(), name: '', avatar: '🧙' };
      this.save();
    }
    return this.data;
  },

  save(patch = {}) {
    this.data = { ...this.load(), ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (_) {}
    return this.data;
  },

  get() { return this.load(); },

  _uuid() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  },
};

window.Profile = Profile;
