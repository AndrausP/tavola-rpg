// src/Character.js
// Modelo de personagem e cálculo de estatísticas derivadas (D&D 5e).

import { RACES, CLASSES, SKILLS, ABILITIES, proficiencyBonus, HIT_DIE_AVG } from './srd.js';

const byKey = (arr, key) => arr.find((x) => x.key === key);

export function abilityMod(score) {
  return Math.floor((score - 10) / 2);
}

/**
 * Recebe os dados brutos de um personagem e devolve a ficha completa calculada.
 * raw = {
 *   name, raceKey, subraceKey, classKey, backgroundKey, alignment, level,
 *   baseAbilities: {str,dex,con,int,wis,cha},   // antes dos bônus raciais
 *   chosenAbilityBonuses: {dex:1,...},          // p/ humano variante / meio-elfo
 *   skillProficiencies: [keys], saveOverrides, photo, color, bio,
 *   maxHpOverride, acOverride, currentHp, tempHp, notes, inventory, spells
 * }
 */
export function computeCharacter(raw = {}) {
  const race = byKey(RACES, raw.raceKey) || null;
  const subrace = race?.subraces ? byKey(race.subraces, raw.subraceKey) : null;
  const klass = byKey(CLASSES, raw.classKey) || null;
  const level = clampInt(raw.level || 1, 1, 20);
  const profBonus = proficiencyBonus(level);

  // Atributos finais = base + bônus racial + sub-raça + escolhidos
  const base = normalizeAbilities(raw.baseAbilities);
  const finalAbilities = { ...base };
  const applyBonuses = (bonuses) => {
    if (!bonuses) return;
    for (const k of Object.keys(bonuses)) {
      finalAbilities[k] = (finalAbilities[k] || 10) + bonuses[k];
    }
  };
  if (race) applyBonuses(race.abilityBonuses);
  if (subrace) applyBonuses(subrace.abilityBonuses);
  applyBonuses(raw.chosenAbilityBonuses);

  // Modificadores
  const mods = {};
  for (const a of ABILITIES) mods[a.key] = abilityMod(finalAbilities[a.key] ?? 10);

  // Testes de resistência
  const saveProf = new Set(klass?.savingThrows || []);
  const saves = {};
  for (const a of ABILITIES) {
    const proficient = saveProf.has(a.key);
    saves[a.key] = { proficient, mod: mods[a.key] + (proficient ? profBonus : 0) };
  }

  // Perícias
  const skillProf = new Set(raw.skillProficiencies || []);
  const expertise = new Set(raw.expertise || []);
  const skills = {};
  for (const s of SKILLS) {
    const proficient = skillProf.has(s.key);
    const hasExp = expertise.has(s.key);
    const bonus = mods[s.ability] + (proficient ? profBonus * (hasExp ? 2 : 1) : 0);
    skills[s.key] = { proficient, expertise: hasExp, mod: bonus, ability: s.ability };
  }

  // PV: nível 1 = dado máximo + CON; demais níveis = média do dado + CON
  let maxHp;
  if (raw.maxHpOverride != null && raw.maxHpOverride !== '') {
    maxHp = clampInt(raw.maxHpOverride, 1, 999);
  } else if (klass) {
    const conMod = mods.con;
    let hpBonusRace = 0;
    // Anão da Colina: +1 PV por nível
    if (raw.subraceKey === 'hill_dwarf') hpBonusRace = level;
    maxHp = klass.hitDie + conMod
      + (level - 1) * (HIT_DIE_AVG[klass.hitDie] + conMod)
      + hpBonusRace;
    maxHp = Math.max(1, maxHp);
  } else {
    maxHp = 1;
  }

  // CA: padrão 10 + DES; defesas sem armadura
  let ac;
  if (raw.acOverride != null && raw.acOverride !== '') {
    ac = clampInt(raw.acOverride, 1, 40);
  } else if (raw.classKey === 'barbarian') {
    ac = 10 + mods.dex + mods.con;
  } else if (raw.classKey === 'monk') {
    ac = 10 + mods.dex + mods.wis;
  } else {
    ac = 10 + mods.dex;
  }

  const initiative = mods.dex;
  const speed = subrace?.speed ?? race?.speed ?? 9;
  const passivePerception = 10 + skills.perception.mod;
  const hitDice = klass ? `${level}d${klass.hitDie}` : '—';

  return {
    name: (raw.name || 'Sem nome').slice(0, 40),
    raceKey: raw.raceKey, raceName: race?.name || '—',
    subraceKey: raw.subraceKey, subraceName: subrace?.name || null,
    classKey: raw.classKey, className: klass?.name || '—',
    classEmoji: klass?.emoji || '🎭',
    raceEmoji: race?.emoji || '🧑',
    backgroundKey: raw.backgroundKey,
    alignment: raw.alignment || 'Neutro',
    level, profBonus,
    abilities: finalAbilities, baseAbilities: base, mods,
    saves, skills,
    maxHp,
    currentHp: raw.currentHp != null ? clampInt(raw.currentHp, -99, maxHp) : maxHp,
    tempHp: clampInt(raw.tempHp || 0, 0, 999),
    ac, initiative, speed, passivePerception, hitDice,
    spellcasting: klass?.spellcasting || null,
    spellSaveDC: klass?.spellcasting ? 8 + profBonus + mods[klass.spellcasting] : null,
    spellAttack: klass?.spellcasting ? profBonus + mods[klass.spellcasting] : null,
    photo: raw.photo || null,
    color: raw.color || '#b5482e',
    bio: (raw.bio || '').slice(0, 2000),
    notes: (raw.notes || '').slice(0, 2000),
    inventory: Array.isArray(raw.inventory) ? raw.inventory.slice(0, 100) : [],
    spells: Array.isArray(raw.spells) ? raw.spells.slice(0, 200) : [],
    features: [...(race?.traits || []), ...(subrace?.traits || []), ...(klass?.level1 || [])],
  };
}

function normalizeAbilities(a = {}) {
  const out = {};
  for (const ab of ABILITIES) out[ab.key] = clampInt(a[ab.key] ?? 10, 1, 30);
  return out;
}

function clampInt(n, min, max) {
  n = parseInt(n, 10);
  if (Number.isNaN(n)) n = min;
  return Math.max(min, Math.min(max, n));
}
