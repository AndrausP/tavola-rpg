// public/js/engine.js
// Carrega os dados do D&D 5e (SRD) do servidor e oferece helpers + cálculo leve para prévia.

const Engine = {
  srd: null,

  async load() {
    if (this.srd) return this.srd;
    const res = await fetch('/api/srd');
    this.srd = await res.json();
    return this.srd;
  },

  race(key) { return this.srd.RACES.find(r => r.key === key) || null; },
  subrace(raceKey, subKey) {
    const r = this.race(raceKey);
    return r?.subraces?.find(s => s.key === subKey) || null;
  },
  klass(key) { return this.srd.CLASSES.find(c => c.key === key) || null; },
  background(key) { return this.srd.BACKGROUNDS.find(b => b.key === key) || null; },
  skill(key) { return this.srd.SKILLS.find(s => s.key === key) || null; },
  get abilities() { return this.srd.ABILITIES; },
  get skills() { return this.srd.SKILLS; },
  get races() { return this.srd.RACES; },
  get classes() { return this.srd.CLASSES; },
  get backgrounds() { return this.srd.BACKGROUNDS; },
  get alignments() { return this.srd.ALIGNMENTS; },

  abilityMod(score) { return Math.floor((score - 10) / 2); },
  proficiencyBonus(level) { return Math.floor((level - 1) / 4) + 2; },
  pointBuyCost(score) { return this.srd.POINT_BUY_COST[score] ?? 99; },
  signed(n) { return n >= 0 ? `+${n}` : `${n}`; },

  /** Valida foto antes de injetar em CSS url() — bloqueia quebra de HTML/CSS e esquemas. */
  safePhoto(v) {
    if (typeof v !== 'string') return null;
    const s = v.trim();
    if (!s) return null;
    if (s.startsWith('data:')) {
      if (s.length > 700000) return null;
      return /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(s) ? s : null;
    }
    if (/^(javascript|vbscript|data|file|blob|http|https):/i.test(s)) return null;
    if (/[<>"'`()\\/{}=;]/.test(s)) return null;
    return s.length <= 16 ? s : null;
  },
  /** Devolve o emoji do retrato (se não for imagem) ou um fallback. */
  photoEmoji(v, fallback = '🧙') {
    const s = this.safePhoto(v);
    return (s && !s.startsWith('data:')) ? s : fallback;
  },
  isPhotoImage(v) {
    const s = this.safePhoto(v);
    return !!(s && s.startsWith('data:'));
  },

  /** Soma todos os bônus de atributo (raça + sub-raça + escolhidos). */
  abilityBonuses(raw) {
    const total = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
    const add = (b) => { if (b) for (const k in b) total[k] = (total[k] || 0) + b[k]; };
    add(this.race(raw.raceKey)?.abilityBonuses);
    add(this.subrace(raw.raceKey, raw.subraceKey)?.abilityBonuses);
    add(raw.chosenAbilityBonuses);
    return total;
  },

  /** Atributos finais. */
  finalAbilities(raw) {
    const base = raw.baseAbilities || {};
    const bonus = this.abilityBonuses(raw);
    const out = {};
    for (const a of this.abilities) out[a.key] = (base[a.key] ?? 10) + (bonus[a.key] || 0);
    return out;
  },

  /** Cálculo leve para o painel de prévia (PV, CA, etc.). */
  computeLite(raw) {
    const level = Math.max(1, Math.min(20, raw.level || 1));
    const finals = this.finalAbilities(raw);
    const mods = {};
    for (const a of this.abilities) mods[a.key] = this.abilityMod(finals[a.key]);
    const klass = this.klass(raw.classKey);
    const sub = this.subrace(raw.raceKey, raw.subraceKey);
    const race = this.race(raw.raceKey);

    let maxHp = 0;
    if (klass) {
      const hitAvg = { 6: 4, 8: 5, 10: 6, 12: 7 }[klass.hitDie];
      let bonus = raw.subraceKey === 'hill_dwarf' ? level : 0;
      maxHp = Math.max(1, klass.hitDie + mods.con + (level - 1) * (hitAvg + mods.con) + bonus);
    }
    let ac = 10 + mods.dex;
    if (raw.classKey === 'barbarian') ac = 10 + mods.dex + mods.con;
    if (raw.classKey === 'monk') ac = 10 + mods.dex + mods.wis;

    return {
      level, finals, mods,
      maxHp, ac,
      initiative: mods.dex,
      speed: sub?.speed ?? race?.speed ?? 9,
      profBonus: this.proficiencyBonus(level),
      passivePerception: 10 + mods.wis + ((raw.skillProficiencies || []).includes('perception') ? this.proficiencyBonus(level) : 0),
    };
  },
};

window.Engine = Engine;
