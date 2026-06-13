// src/validate.js
// Camada de validação e sanitização de TODA entrada vinda do cliente.
// Princípio: nada do cliente é confiável. Tudo passa por allowlist explícita.

import { RACES, CLASSES, BACKGROUNDS, SKILLS, ABILITIES, ALIGNMENTS } from './srd.js';

// Conjuntos de chaves válidas (allowlist)
const RACE_KEYS = new Set(RACES.map(r => r.key));
const SUBRACE_KEYS = new Set(RACES.flatMap(r => (r.subraces || []).map(s => s.key)));
const CLASS_KEYS = new Set(CLASSES.map(c => c.key));
const BG_KEYS = new Set(BACKGROUNDS.map(b => b.key));
const SKILL_KEYS = new Set(SKILLS.map(s => s.key));
const ABILITY_KEYS = ABILITIES.map(a => a.key);
const ALIGNMENT_SET = new Set(ALIGNMENTS);
const METHODS = new Set(['standard_array', 'point_buy', 'manual']);

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

// Limites de tamanho/payload
export const LIMITS = {
  NAME: 40, CAMP_NAME: 60, PROFILE_NAME: 30, ALIGN: 40,
  BIO: 2000, NOTES: 2000, SCENE: 4000, CHAT: 500, LABEL: 40,
  EXPR: 60, ITEM: 80, AVATAR: 16, PROFILE_ID: 64,
  PHOTO_CHARS: 700000,        // ~ 512 KB de imagem em base64
  INVENTORY: 100, SPELLS: 200, SKILLS: 18, ABILITY_BONUSES: 6,
  MAX_CHARS_PER_ROOM: 40,
};

// ---------- Primitivos ----------
export function sanitizeText(v, max, { newlines = false } = {}) {
  let s = v == null ? '' : String(v);
  // remove caracteres de controle (mantém \n e \t se newlines=true)
  s = newlines
    ? s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    : s.replace(/[\u0000-\u001F\u007F]/g, '');
  s = s.trim();
  if (s.length > max) s = s.slice(0, max);
  return s;
}

export function clampInt(v, min, max, def = min) {
  let n = parseInt(v, 10);
  if (!Number.isFinite(n)) n = def;
  return Math.max(min, Math.min(max, n));
}

export function isHexColor(v) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v); }

/** Aceita SOMENTE emoji/símbolo curto OU data:image base64 estrito. Bloqueia esquemas e quebra de CSS/HTML. */
export function validatePhoto(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  if (s.startsWith('data:')) {
    if (s.length > LIMITS.PHOTO_CHARS) return null;
    return /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(s) ? s : null;
  }
  // emoji/símbolo curto: sem esquemas perigosos e sem caracteres que quebram HTML/CSS
  if (/^(javascript|vbscript|data|file|blob|http|https):/i.test(s)) return null;
  if (/[<>"'`()\\/{}=;]/.test(s)) return null;
  if (s.length > LIMITS.AVATAR) return null;
  return s;
}

export function validateAvatar(v, fallback = '🧙') {
  const p = validatePhoto(v);
  // avatar não pode ser imagem data: (é só emoji)
  if (p && !p.startsWith('data:')) return p;
  return fallback;
}

function cleanKey(v, set) { return (typeof v === 'string' && set.has(v)) ? v : null; }

// ---------- Perfil ----------
export function validateProfile(input = {}) {
  let id = String(input?.id || '').replace(/[^\w-]/g, '').slice(0, LIMITS.PROFILE_ID);
  if (!id) id = 'anon-' + Math.random().toString(36).slice(2, 12);
  return {
    id,
    name: sanitizeText(input?.name, LIMITS.PROFILE_NAME) || 'Aventureiro',
    avatar: validateAvatar(input?.avatar),
  };
}

// ---------- Configuração de mesa (parcial) ----------
export function validateConfig(input = {}, { partial = false } = {}) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  if ('name' in input) out.name = sanitizeText(input.name, LIMITS.CAMP_NAME) || 'Nova Campanha';
  if ('scene' in input) out.scene = sanitizeText(input.scene, LIMITS.SCENE, { newlines: true });
  if ('levelStart' in input) out.levelStart = clampInt(input.levelStart, 1, 20, 1);
  if ('maxPlayers' in input) out.maxPlayers = clampInt(input.maxPlayers, 1, 10, 6);
  if ('abilityMethod' in input) out.abilityMethod = METHODS.has(input.abilityMethod) ? input.abilityMethod : 'standard_array';
  if ('allowPlayerRolls' in input) out.allowPlayerRolls = !!input.allowPlayerRolls;
  if ('dmCanEdit' in input) out.dmCanEdit = !!input.dmCanEdit;
  if ('allowedRaces' in input) out.allowedRaces = Array.isArray(input.allowedRaces)
    ? input.allowedRaces.filter(k => RACE_KEYS.has(k)).slice(0, 20) : null;
  if ('allowedClasses' in input) out.allowedClasses = Array.isArray(input.allowedClasses)
    ? input.allowedClasses.filter(k => CLASS_KEYS.has(k)).slice(0, 20) : null;
  return out;
}

// ---------- Ficha de personagem (parcial, allowlist) ----------
// Só inclui chaves que vieram no input → preserva semântica de atualização parcial (ex.: só PV).
export function buildCharacterRaw(input = {}) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;

  if ('name' in input) out.name = sanitizeText(input.name, LIMITS.NAME) || 'Sem nome';
  if ('photo' in input) out.photo = validatePhoto(input.photo);
  if ('color' in input) out.color = isHexColor(input.color) ? input.color : '#b5482e';
  if ('alignment' in input) out.alignment = ALIGNMENT_SET.has(input.alignment) ? input.alignment : sanitizeText(input.alignment, LIMITS.ALIGN) || 'Neutro';
  if ('bio' in input) out.bio = sanitizeText(input.bio, LIMITS.BIO, { newlines: true });
  if ('notes' in input) out.notes = sanitizeText(input.notes, LIMITS.NOTES, { newlines: true });

  if ('raceKey' in input) out.raceKey = cleanKey(input.raceKey, RACE_KEYS);
  if ('subraceKey' in input) out.subraceKey = cleanKey(input.subraceKey, SUBRACE_KEYS);
  if ('classKey' in input) out.classKey = cleanKey(input.classKey, CLASS_KEYS);
  if ('backgroundKey' in input) out.backgroundKey = cleanKey(input.backgroundKey, BG_KEYS);

  if ('level' in input) out.level = clampInt(input.level, 1, 20, 1);
  if ('currentHp' in input) out.currentHp = clampInt(input.currentHp, -99, 999, 0);
  if ('tempHp' in input) out.tempHp = clampInt(input.tempHp, 0, 999, 0);
  if ('maxHpOverride' in input && input.maxHpOverride !== '' && input.maxHpOverride != null)
    out.maxHpOverride = clampInt(input.maxHpOverride, 1, 999, 1);
  if ('acOverride' in input && input.acOverride !== '' && input.acOverride != null)
    out.acOverride = clampInt(input.acOverride, 1, 40, 10);
  if ('isNPC' in input) out.isNPC = !!input.isNPC;

  // atributos base — lê SOMENTE chaves conhecidas (imune a __proto__ etc.)
  if (input.baseAbilities && typeof input.baseAbilities === 'object') {
    const ba = {};
    for (const k of ABILITY_KEYS) ba[k] = clampInt(input.baseAbilities[k], 1, 30, 10);
    out.baseAbilities = ba;
  }
  if (input.chosenAbilityBonuses && typeof input.chosenAbilityBonuses === 'object') {
    const cb = {};
    let n = 0;
    for (const k of ABILITY_KEYS) {
      if (input.chosenAbilityBonuses[k] != null && n < LIMITS.ABILITY_BONUSES) {
        cb[k] = clampInt(input.chosenAbilityBonuses[k], 0, 2, 0);
        n++;
      }
    }
    out.chosenAbilityBonuses = cb;
  }

  if (Array.isArray(input.skillProficiencies))
    out.skillProficiencies = [...new Set(input.skillProficiencies.filter(k => SKILL_KEYS.has(k)))].slice(0, LIMITS.SKILLS);
  if (Array.isArray(input.expertise))
    out.expertise = [...new Set(input.expertise.filter(k => SKILL_KEYS.has(k)))].slice(0, LIMITS.SKILLS);
  if (Array.isArray(input.inventory))
    out.inventory = input.inventory.slice(0, LIMITS.INVENTORY).map(i => sanitizeText(typeof i === 'string' ? i : (i?.name || ''), LIMITS.ITEM)).filter(Boolean);
  if (Array.isArray(input.spells))
    out.spells = input.spells.slice(0, LIMITS.SPELLS).map(i => sanitizeText(typeof i === 'string' ? i : (i?.name || ''), LIMITS.ITEM)).filter(Boolean);

  // NUNCA aceita do cliente: ownerProfileId, id, _isSeed, ou qualquer chave perigosa.
  for (const k of DANGEROUS_KEYS) delete out[k];
  return out;
}

// ---------- Outros ----------
export function validateRoomCode(v) {
  const s = String(v || '').toUpperCase().trim();
  return /^[A-Z0-9]{5}$/.test(s) ? s : null;
}
export function sanitizeLabel(v) { return sanitizeText(v, LIMITS.LABEL); }
export function sanitizeChat(v) { return sanitizeText(v, LIMITS.CHAT); }
export function sanitizeExpression(v) {
  const s = String(v || '').trim();
  if (!s || s.length > LIMITS.EXPR) return null;
  return s;
}
