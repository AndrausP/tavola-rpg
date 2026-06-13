// test/test_auth.mjs
import { spawn } from 'child_process';
import { io } from 'socket.io-client';
import { readFileSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB = join(__dirname, '..', 'data', 'db.json');
try { rmSync(DB); } catch (_) {}
try { rmSync(DB + '.tmp'); } catch (_) {}

const PORT = 3996;
const server = spawn('node', ['server.js'], { env: { ...process.env, PORT, NODE_ENV: 'development' }, stdio: 'pipe' });
await new Promise((r) => server.stdout.on('data', (d) => { if (d.toString().includes('rodando')) r(); }));
const base = `http://localhost:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗', m)); };

const post = async (path, body) => { const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); let d = {}; try { d = await r.json(); } catch (_) {} return { status: r.status, ...d }; };
const get = async (path, token) => { const r = await fetch(base + path, { headers: token ? { Authorization: 'Bearer ' + token } : {} }); let d = {}; try { d = await r.json(); } catch (_) {} return { status: r.status, ...d }; };
const hitConfirm = async (url) => { const r = await fetch(url, { redirect: 'manual' }); return { status: r.status, location: r.headers.get('location') }; };

const thisYear = new Date().getFullYear();
const adultBirth = `${thisYear - 30}-06-15`;
const minorBirth = `${thisYear - 15}-06-15`;
const underageBirth = `${thisYear - 10}-06-15`;

async function registerConfirmLogin(email, birthdate) {
  const reg = await post('/api/auth/register', { name: 'User ' + email, email, birthdate, password: 'senhaForte123' });
  if (!reg.ok || !reg.devConfirmUrl) return { error: 'registro falhou', reg };
  await hitConfirm(reg.devConfirmUrl);
  const login = await post('/api/auth/login', { email, password: 'senhaForte123' });
  return login;
}

try {
  // ---------- Registro / validações ----------
  console.log('• Registro e validações');
  const r1 = await post('/api/auth/register', { name: 'Aria', email: 'aria@teste.com', birthdate: adultBirth, password: 'senhaForte123' });
  ok(r1.ok && r1.needsConfirm, 'registro válido pede confirmação');
  ok(!!r1.devConfirmUrl, 'modo dev retorna link de confirmação');

  ok((await post('/api/auth/register', { name: 'X', email: 'aria@teste.com', birthdate: adultBirth, password: 'senhaForte123' })).status === 409, 'e-mail duplicado rejeitado (409)');
  ok((await post('/api/auth/register', { name: 'X', email: 'naoemail', birthdate: adultBirth, password: 'senhaForte123' })).status === 400, 'e-mail inválido rejeitado');
  ok((await post('/api/auth/register', { name: 'X', email: 'curta@teste.com', birthdate: adultBirth, password: '123' })).status === 400, 'senha curta rejeitada');
  ok((await post('/api/auth/register', { name: 'X', email: 'crianca@teste.com', birthdate: underageBirth, password: 'senhaForte123' })).status === 400, 'menor de 13 anos rejeitado');

  // ---------- Confirmação obrigatória ----------
  console.log('• Confirmação de e-mail');
  const preLogin = await post('/api/auth/login', { email: 'aria@teste.com', password: 'senhaForte123' });
  ok(preLogin.status === 403 && preLogin.needsConfirm, 'login bloqueado antes de confirmar e-mail');

  const conf = await hitConfirm(r1.devConfirmUrl);
  ok(conf.status === 302 && /confirmado=1/.test(conf.location || ''), 'confirmação redireciona com sucesso');
  ok((await hitConfirm(r1.devConfirmUrl)).location.includes('confirmado=0'), 'token de confirmação é de uso único');

  // ---------- Login ----------
  console.log('• Login');
  const login = await post('/api/auth/login', { email: 'aria@teste.com', password: 'senhaForte123' });
  ok(login.ok && login.token && login.user, 'login após confirmação retorna token e usuário');
  ok(login.user.isAdult === true, 'usuário marcado como adulto (30 anos)');
  ok(!('hash' in login.user) && !('salt' in login.user), 'dados públicos não expõem hash/salt');

  ok((await post('/api/auth/login', { email: 'aria@teste.com', password: 'senhaerrada' })).status === 401, 'senha errada rejeitada');
  const me = await get('/api/auth/me', login.token);
  ok(me.ok && me.user.email === 'aria@teste.com', '/me valida o token');
  ok((await get('/api/auth/me', 'tokenfalso')).status === 401, 'token inválido rejeitado no /me');

  // ---------- Hashing no disco ----------
  console.log('• Senhas e tokens hasheados no disco');
  await wait(1000);
  const db = JSON.parse(readFileSync(DB, 'utf-8'));
  const dbStr = JSON.stringify(db);
  ok(!dbStr.includes('senhaForte123'), 'senha em texto puro NÃO está no banco');
  ok(!Object.keys(db.authSessions).includes(login.token), 'token de sessão NÃO é guardado em texto puro (só hash)');
  const userRec = Object.values(db.users).find(u => u.email === 'aria@teste.com');
  ok(userRec && userRec.salt && userRec.hash && !userRec.password, 'usuário guarda salt+hash, sem campo de senha');

  // ---------- Logout invalida sessão ----------
  console.log('• Logout');
  await post('/api/auth/logout', { token: login.token });
  ok((await get('/api/auth/me', login.token)).status === 401, 'sessão inválida após logout');

  // ---------- Socket exige autenticação ----------
  console.log('• Socket exige login');
  const anon = io(base, { transports: ['websocket'] });
  await wait(200);
  const anonCreate = await new Promise((res) => anon.emit('room:create', { config: {} }, res));
  ok(!anonCreate.ok && /login/i.test(anonCreate.error || ''), 'socket sem token não cria mesa');
  anon.close();

  // novo login para ter token válido p/ socket
  const login2 = await post('/api/auth/login', { email: 'aria@teste.com', password: 'senhaForte123' });
  const authed = io(base, { transports: ['websocket'], auth: { token: login2.token } });
  await wait(200);
  const dash = await new Promise((res) => authed.emit('dashboard:load', res));
  ok(dash.ok && dash.user.email === 'aria@teste.com', 'dashboard:load autenticado funciona');

  // ---------- Trava de idade 18+ ----------
  console.log('• Trava de idade (18+)');
  const minorToken = (await registerConfirmLogin('jovem@teste.com', minorBirth)).token;
  ok(minorToken, 'menor (15) cria conta e loga');

  // adulto cria mesa adulta
  const adultCreate = await new Promise((res) => authed.emit('room:create', { config: { name: 'Mesa Adulta', adult: true } }, res));
  ok(adultCreate.ok && adultCreate.state.config.adult === true, 'mesa adulta criada');
  const adultCode = adultCreate.code;

  const minorSock = io(base, { transports: ['websocket'], auth: { token: minorToken } });
  await wait(200);
  const minorJoin = await new Promise((res) => minorSock.emit('room:join', { code: adultCode }, res));
  ok(!minorJoin.ok && /18|maior/i.test(minorJoin.error || ''), 'menor é barrado em mesa 18+');

  // mesa normal: menor entra
  const normalCreate = await new Promise((res) => authed.emit('room:create', { config: { name: 'Mesa Livre' } }, res));
  // authed agora está em outra sala; cria nova substitui? cria nova mesa e troca de sala — ok para teste
  const normalCode = normalCreate.code;
  const minorJoin2 = await new Promise((res) => minorSock.emit('room:join', { code: normalCode }, res));
  ok(minorJoin2.ok, 'menor entra normalmente em mesa livre');

  authed.close(); minorSock.close();
} catch (e) {
  fail++; console.log('  ✗ EXCEÇÃO:', e.message, e.stack);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} Autenticação: ${pass} passaram, ${fail} falharam`);
server.kill('SIGKILL');
process.exit(fail === 0 ? 0 : 1);
