// public/js/profile.js
// Gerencia a sessão de login no cliente: token e usuário em cache.

const TKEY = 'tavola:session';
const UKEY = 'tavola:user';

const Session = {
  getToken() { try { return localStorage.getItem(TKEY); } catch (_) { return null; } },
  setToken(t) { try { t ? localStorage.setItem(TKEY, t) : localStorage.removeItem(TKEY); } catch (_) {} },
  getUser() { try { const r = localStorage.getItem(UKEY); return r ? JSON.parse(r) : null; } catch (_) { return null; } },
  setUser(u) { try { u ? localStorage.setItem(UKEY, JSON.stringify(u)) : localStorage.removeItem(UKEY); } catch (_) {} },
  clear() { this.setToken(null); this.setUser(null); },
};

window.Session = Session;
