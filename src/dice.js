// src/dice.js
// Motor de rolagem de dados. Suporta notação tipo: 2d6+3, d20, 4d6kh3, 1d8-1, etc.
// Server-authoritative: o servidor rola e transmite o resultado para todos.

function rollDie(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

/**
 * Rola uma expressão de dados.
 * Suporta termos separados por + ou -, cada um podendo ser:
 *   - constante: "3"
 *   - dados: "NdM" com modificadores opcionais "khX" (keep highest), "klX" (keep lowest)
 * Ex.: "2d6+3", "1d20", "4d6kh3", "1d8-1+2d4"
 * @returns {object} { ok, total, expression, parts:[{type, ...}], text }
 */
export function rollExpression(expr, opts = {}) {
  if (!expr || typeof expr !== 'string') return { ok: false, error: 'Expressão vazia.' };
  const clean = expr.replace(/\s+/g, '').toLowerCase();
  if (clean.length > 60) return { ok: false, error: 'Expressão muito longa.' };
  if (!/^[0-9d+\-khl]+$/.test(clean)) return { ok: false, error: 'Caracteres inválidos.' };

  // separa em termos preservando o sinal
  const termRegex = /([+-]?)([^+-]+)/g;
  const parts = [];
  let total = 0;
  let match;
  let count = 0;

  while ((match = termRegex.exec(clean)) !== null) {
    if (++count > 20) return { ok: false, error: 'Muitos termos.' };
    const sign = match[1] === '-' ? -1 : 1;
    const term = match[2];
    if (!term) continue;

    if (term.includes('d')) {
      const dm = term.match(/^(\d*)d(\d+)(k[hl]\d+)?$/);
      if (!dm) return { ok: false, error: `Termo inválido: ${term}` };
      let n = dm[1] === '' ? 1 : parseInt(dm[1], 10);
      const sides = parseInt(dm[2], 10);
      const keep = dm[3];
      if (n < 1 || n > 100) return { ok: false, error: 'Número de dados fora do limite (1–100).' };
      if (![2, 3, 4, 6, 8, 10, 12, 20, 100].includes(sides)) {
        return { ok: false, error: `d${sides} não é um dado válido.` };
      }
      let rolls = Array.from({ length: n }, () => rollDie(sides));
      let kept = [...rolls];
      if (keep) {
        const km = keep.match(/^k([hl])(\d+)$/);
        const mode = km[1]; const k = parseInt(km[2], 10);
        const sorted = [...rolls].sort((a, b) => b - a);
        kept = mode === 'h' ? sorted.slice(0, k) : sorted.slice(-k);
      }
      const subtotal = kept.reduce((a, b) => a + b, 0) * sign;
      total += subtotal;
      parts.push({ type: 'dice', sides, count: n, rolls, kept, keep: keep || null, sign, subtotal });
    } else {
      const val = parseInt(term, 10);
      if (Number.isNaN(val)) return { ok: false, error: `Termo inválido: ${term}` };
      total += val * sign;
      parts.push({ type: 'const', value: val, sign });
    }
  }

  return { ok: true, total, expression: clean, parts, text: formatResult(parts, total) };
}

/**
 * Rolagem de d20 com vantagem/desvantagem e modificador.
 * @param {number} modifier
 * @param {'normal'|'advantage'|'disadvantage'} mode
 */
export function rollD20(modifier = 0, mode = 'normal') {
  const a = rollDie(20);
  const b = rollDie(20);
  let chosen, dice;
  if (mode === 'advantage') { chosen = Math.max(a, b); dice = [a, b]; }
  else if (mode === 'disadvantage') { chosen = Math.min(a, b); dice = [a, b]; }
  else { chosen = a; dice = [a]; }

  const total = chosen + modifier;
  const isCrit = chosen === 20;
  const isFumble = chosen === 1;
  return {
    ok: true, type: 'd20', mode, modifier,
    dice, chosen, total, isCrit, isFumble,
    text: `d20${mode !== 'normal' ? ` (${dice.join('/')})` : ''} → ${chosen}${modifier ? (modifier > 0 ? `+${modifier}` : modifier) : ''} = ${total}`,
  };
}

function formatResult(parts, total) {
  const segs = parts.map((p, i) => {
    const sign = p.sign < 0 ? '−' : (i === 0 ? '' : '+');
    if (p.type === 'const') return `${sign}${p.value}`;
    const rollsStr = p.keep
      ? `[${p.rolls.map(r => p.kept.includes(r) ? r : `~~${r}~~`).join(',')}]`
      : `[${p.rolls.join(',')}]`;
    return `${sign}${p.count}d${p.sides}${rollsStr}`;
  });
  return `${segs.join(' ')} = ${total}`;
}

// Tipos rápidos de dado para a interface
export const QUICK_DICE = [4, 6, 8, 10, 12, 20, 100];
