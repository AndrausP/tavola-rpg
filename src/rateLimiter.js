// src/rateLimiter.js
// Limitador de taxa simples (janela deslizante) por socket e por categoria de ação.
// Em memória, com limpeza no disconnect. Protege contra spam/DoS.

export function createRateLimiter() {
  const buckets = new Map(); // socketId -> Map(key -> number[] timestamps)

  function check(id, key, max, windowMs) {
    const now = Date.now();
    let m = buckets.get(id);
    if (!m) { m = new Map(); buckets.set(id, m); }
    let arr = m.get(key);
    if (!arr) { arr = []; m.set(key, arr); }
    const cutoff = now - windowMs;
    while (arr.length && arr[0] < cutoff) arr.shift();
    if (arr.length >= max) return false;
    arr.push(now);
    return true;
  }

  function cleanup(id) { buckets.delete(id); }

  return { check, cleanup };
}

// Limites por ação: [máximo, janela_ms]
export const RATE = {
  global:            [80, 10000],
  'room:create':     [5, 60000],
  'room:join':       [12, 60000],
  'room:resume':     [12, 60000],
  'room:config':     [25, 10000],
  'character:save':  [10, 15000],
  'character:preview':[30, 10000],
  'character:raw':   [25, 10000],
  'character:delete':[10, 30000],
  'roll':            [20, 10000],
  'chat':            [10, 5000],
  'scene':           [20, 10000],
  'profile':         [12, 30000],
};
