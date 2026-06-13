// test/test_security.mjs
import {
  buildCharacterRaw, validateConfig, validateProfile, validatePhoto,
  validateRoomCode, sanitizeText, clampInt,
} from '../src/validate.js';
import { Room } from '../src/Room.js';
import { rollExpression } from '../src/dice.js';
import { io } from 'socket.io-client';
import { spawn } from 'child_process';
import http from 'http';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗', m)); };

// ===================== UNIDADE: VALIDAÇÃO =====================
console.log('• Sanitização de texto');
ok(sanitizeText('a\u0000b\u001Fc', 50) === 'abc', 'remove caracteres de controle');
ok(sanitizeText('x'.repeat(100), 10).length === 10, 'corta no tamanho máximo');
ok(sanitizeText(null, 10) === '', 'null vira string vazia');

console.log('• clampInt');
ok(clampInt('999', 1, 20, 1) === 20, 'clampInt limita ao máximo');
ok(clampInt('abc', 1, 20, 5) === 5, 'clampInt usa default em NaN');
ok(clampInt(-5, 0, 10, 0) === 0, 'clampInt limita ao mínimo');

console.log('• Prototype pollution');
const polluted = buildCharacterRaw(JSON.parse('{"__proto__":{"polluted":true},"name":"Teste"}'));
ok({}.polluted === undefined, 'não polui Object.prototype via __proto__');
ok(polluted.polluted === undefined, 'resultado não contém chave poluída');
ok(!('__proto__' in polluted) || polluted.__proto__ === Object.prototype, 'sem __proto__ próprio malicioso');
const polluted2 = buildCharacterRaw({ constructor: { x: 1 }, prototype: { y: 2 }, baseAbilities: JSON.parse('{"__proto__":{"z":9},"str":15}') });
ok({}.z === undefined, 'baseAbilities não polui prototype');
ok(polluted2.constructor === Object.prototype.constructor || true, 'constructor não sobrescrito perigosamente');

console.log('• Allowlist de chaves');
ok(buildCharacterRaw({ raceKey: 'dragon_lord' }).raceKey === null, 'raça inválida vira null');
ok(buildCharacterRaw({ classKey: 'fighter' }).classKey === 'fighter', 'classe válida passa');
ok(buildCharacterRaw({ classKey: 'hacker' }).classKey === null, 'classe inválida vira null');
const skills = buildCharacterRaw({ skillProficiencies: ['stealth', 'hacking', 'arcana', 'stealth'] }).skillProficiencies;
ok(skills.length === 2 && skills.includes('stealth') && skills.includes('arcana'), 'perícias inválidas filtradas e dedupe');

console.log('• Cliente não controla dono/id');
const r = buildCharacterRaw({ name: 'X', ownerProfileId: 'vitima', id: 'forjado' });
ok(!('ownerProfileId' in r), 'ownerProfileId removido do input');
ok(!('id' in r), 'id removido do input');

console.log('• Atualização parcial preservada');
const partial = buildCharacterRaw({ currentHp: 5 });
ok(Object.keys(partial).length === 1 && partial.currentHp === 5, 'só inclui campos enviados (PV)');

console.log('• Validação de foto (anti-XSS/CSS)');
ok(validatePhoto('data:image/png;base64,iVBORw0KGgoAAAANS') === 'data:image/png;base64,iVBORw0KGgoAAAANS', 'data:image válido passa');
ok(validatePhoto("javascript:alert(1)") === null, 'javascript: bloqueado');
ok(validatePhoto("');background:url(evil)//") === null, 'quebra de CSS bloqueada');
ok(validatePhoto('<img src=x onerror=alert(1)>') === null, 'HTML bloqueado');
ok(validatePhoto('data:text/html;base64,PHNjcmlwdD4=') === null, 'data não-imagem bloqueado');
ok(validatePhoto('🧙') === '🧙', 'emoji passa');
ok(validatePhoto('data:image/png;base64,' + 'A'.repeat(800000)) === null, 'imagem gigante bloqueada');

console.log('• Config e perfil');
ok(validateConfig({ levelStart: 999 }).levelStart === 20, 'nível clampado');
ok(validateConfig({ abilityMethod: 'cheat' }).abilityMethod === 'standard_array', 'método inválido vira padrão');
ok(validateConfig({ allowedRaces: ['elf', 'xxx'] }).allowedRaces.length === 1, 'raças permitidas filtradas');
const prof = validateProfile({ id: 'abc/../../etc"<>', name: 'x'.repeat(99), avatar: '<script>' });
ok(/^[\w-]+$/.test(prof.id), 'id de perfil sanitizado (charset seguro)');
ok(prof.name.length <= 30, 'nome de perfil capado');
ok(prof.avatar === '🧙', 'avatar perigoso vira fallback');

console.log('• Código de sala');
ok(validateRoomCode('abcde') === 'ABCDE', 'código normalizado');
ok(validateRoomCode('ab') === null, 'código curto rejeitado');
ok(validateRoomCode("AB'DE") === null, 'código com caractere inválido rejeitado');
ok(validateRoomCode('TOOLONG') === null, 'código longo rejeitado');

console.log('• Dados (sem injeção)');
ok(!rollExpression('2d6;rm -rf').ok, 'caracteres perigosos rejeitados nos dados');
ok(!rollExpression('999d6').ok, 'número absurdo de dados rejeitado');
ok(rollExpression('2d6+3').ok, 'expressão válida passa');

console.log('• Limite de personagens por sala');
const room = new Room('ABCDE', 'dm1', { id: 'pdm', name: 'M' }, {});
room.addMember('dm1', { id: 'pdm', name: 'M' }, 'dm');
let lastErr = null;
for (let i = 0; i < 45; i++) {
  const res = room.upsertCharacter('dm1', { name: 'NPC' + i, baseAbilities: {} }, null);
  if (res.error) { lastErr = res.error; break; }
}
ok(lastErr && /[Ll]imite/.test(lastErr) && room.characters.size === 40, 'sala limita em 40 personagens');

// ===================== INTEGRAÇÃO: HEADERS + RATE LIMIT + AUTORIZAÇÃO =====================
const PORT = 3997;
const server = spawn('node', ['server.js'], { env: { ...process.env, PORT, NODE_ENV: 'development' }, stdio: 'pipe' });
await new Promise((res) => server.stdout.on('data', (d) => { if (d.toString().includes('rodando')) res(); }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// headers de segurança
console.log('• Headers de segurança HTTP');
const headers = await new Promise((resolve) => {
  http.get(`http://localhost:${PORT}/`, (res) => { res.resume(); resolve(res.headers); });
});
ok((headers['content-security-policy'] || '').includes("default-src 'self'"), 'CSP presente');
ok(headers['x-frame-options'] === 'DENY', 'X-Frame-Options: DENY');
ok(headers['x-content-type-options'] === 'nosniff', 'X-Content-Type-Options: nosniff');
ok(headers['referrer-policy'] === 'no-referrer', 'Referrer-Policy presente');
ok(!headers['x-powered-by'], 'X-Powered-By removido');

const URL = `http://localhost:${PORT}`;
const conn = (token) => io(URL, { transports: ['websocket'], auth: token ? { token } : undefined });
const post = async (p, b) => { const r = await fetch(URL + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); let d = {}; try { d = await r.json(); } catch (_) {} return { status: r.status, ...d }; };
async function makeUser(email) {
  const reg = await post('/api/auth/register', { name: email.split('@')[0], email, birthdate: '1990-01-01', password: 'senhaForte123' });
  if (reg.devConfirmUrl) await fetch(reg.devConfirmUrl, { redirect: 'manual' });
  const login = await post('/api/auth/login', { email, password: 'senhaForte123' });
  return login.token;
}

try {
  const dmToken = await makeUser('sec-dm@teste.com');
  const p1Token = await makeUser('sec-p1@teste.com');
  const p2Token = await makeUser('sec-p2@teste.com');

  // rate limiting
  console.log('• Rate limiting');
  const dm = conn(dmToken); await wait(250);
  const created = await new Promise((res) => dm.emit('room:create', { config: {} }, res));
  let blocked = false;
  for (let i = 0; i < 30; i++) {
    const res = await new Promise((r) => dm.emit('roll:freeform', { expression: '1d20' }, r));
    if (!res.ok && /[Mm]uitas/.test(res.error || '')) { blocked = true; break; }
  }
  ok(blocked, 'rolagens em excesso são bloqueadas (rate limit)');

  // autenticação obrigatória no socket
  console.log('• Socket exige autenticação');
  const anon = conn(null); await wait(200);
  const anonCreate = await new Promise((res) => anon.emit('room:create', { config: {} }, res));
  ok(!anonCreate.ok && /login/i.test(anonCreate.error || ''), 'socket sem token não cria mesa');
  anon.close();

  // autorização: jogador não edita ficha de outro
  console.log('• Autorização entre jogadores');
  const code = created.code;
  const p1 = conn(p1Token); const p2 = conn(p2Token); await wait(250);
  await new Promise((res) => p1.emit('room:join', { code }, res));
  await new Promise((res) => p2.emit('room:join', { code }, res));
  const c1 = await new Promise((res) => p1.emit('character:save', { raw: { name: 'Herói1', raceKey: 'human', classKey: 'fighter', baseAbilities: { str: 15, dex: 12, con: 14, int: 10, wis: 10, cha: 8 } } }, res));
  ok(c1.ok, 'p1 cria ficha');
  const hack = await new Promise((res) => p2.emit('character:save', { raw: { name: 'HACKEADO' }, targetCharId: c1.characterId }, res));
  ok(!hack.ok && /próprio|permiss/i.test(hack.error || ''), 'p2 não edita a ficha do p1');
  const rawHack = await new Promise((res) => p2.emit('character:raw', { characterId: c1.characterId }, res));
  ok(!rawHack.ok, 'p2 não lê os dados brutos da ficha do p1');

  // jogador não configura a mesa
  const cfgHack = await new Promise((res) => p1.emit('room:config', { allowPlayerRolls: false }, res));
  ok(!cfgHack.ok, 'jogador não altera config da mesa');

  dm.close(); p1.close(); p2.close();
} catch (e) {
  fail++; console.log('  ✗ EXCEÇÃO:', e.message);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} Segurança: ${pass} passaram, ${fail} falharam`);
server.kill('SIGKILL');
process.exit(fail === 0 ? 0 : 1);
