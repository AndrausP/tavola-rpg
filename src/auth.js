// src/auth.js
// Primitivos de autenticação: hash de senha (scrypt nativo), tokens e validações.

import crypto from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(crypto.scrypt);
const KEYLEN = 64;

// ---------- Senha ----------
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, KEYLEN);
  return { salt, hash: derived.toString('hex') };
}

export async function verifyPassword(password, salt, hash) {
  if (!salt || !hash || typeof password !== 'string') return false;
  try {
    const derived = await scrypt(password, salt, KEYLEN);
    const known = Buffer.from(hash, 'hex');
    return derived.length === known.length && crypto.timingSafeEqual(derived, known);
  } catch (_) {
    return false;
  }
}

// ---------- Tokens (sessão e e-mail) ----------
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}
export function sha256(str) {
  return crypto.createHash('sha256').update(String(str)).digest('hex');
}

// ---------- Validações ----------
export function validateEmail(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (s.length < 3 || s.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s;
}

export function validatePassword(v) {
  if (typeof v !== 'string') return null;
  if (v.length < 8 || v.length > 200) return null;
  return v;
}

export function computeAge(birthdate) {
  if (typeof birthdate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) return null;
  const d = new Date(birthdate + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

/** Valida data de nascimento e retorna { birthdate, age, isAdult }. */
export function validateBirthdate(v) {
  const age = computeAge(v);
  if (age === null || age < 0 || age > 120) return null;
  return { birthdate: v, age, isAdult: age >= 18 };
}

export const MIN_AGE = 13; // idade mínima para criar conta
