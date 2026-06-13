// test/test_integration.mjs
import { io } from 'socket.io-client';
import { spawn } from 'child_process';

const PORT = 3998;
const server = spawn('node', ['server.js'], { env: { ...process.env, PORT, NODE_ENV: 'development' }, stdio: 'pipe' });
await new Promise((r) => server.stdout.on('data', (d) => { if (d.toString().includes('rodando')) r(); }));

const base = `http://localhost:${PORT}`;
const conn = (token) => io(base, { transports: ['websocket'], auth: token ? { token } : undefined });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (p, b) => { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); let d = {}; try { d = await r.json(); } catch (_) {} return { status: r.status, ...d }; };
async function makeUser(email, birth = '1990-01-01') {
  const reg = await post('/api/auth/register', { name: email.split('@')[0], email, birthdate: birth, password: 'senhaForte123' });
  if (reg.devConfirmUrl) await fetch(reg.devConfirmUrl, { redirect: 'manual' });
  const login = await post('/api/auth/login', { email, password: 'senhaForte123' });
  return login.token;
}

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗', m)); };

try {
  const dmToken = await makeUser('dm-int@teste.com');
  const plToken = await makeUser('player-int@teste.com');
  ok(dmToken && plToken, 'usuários de teste autenticados');

  const dm = conn(dmToken); const player = conn(plToken);
  await wait(300);

  const created = await new Promise((res) => dm.emit('room:create', {
    config: { name: 'A Cripta Sombria', levelStart: 1, abilityMethod: 'standard_array', maxPlayers: 4 },
  }, res));
  ok(created.ok && created.code?.length === 5, 'mesa criada com código de 5 chars');
  ok(created.role === 'dm', 'criador é mestre');
  const code = created.code;

  const joined = await new Promise((res) => player.emit('room:join', { code }, res));
  ok(joined.ok && joined.role === 'player', 'jogador entrou');
  ok(joined.state.members.length === 2, 'mesa com 2 membros');

  const rawChar = {
    name: 'Aria Folha-Prata', raceKey: 'elf', subraceKey: 'wood_elf', classKey: 'ranger', level: 1,
    baseAbilities: { str: 10, dex: 15, con: 13, int: 12, wis: 14, cha: 8 },
    backgroundKey: 'outlander', skillProficiencies: ['athletics', 'survival', 'stealth', 'perception', 'nature'], color: '#3d8b5f',
  };
  const preview = await new Promise((res) => player.emit('character:preview', rawChar, res));
  ok(preview.ok && preview.character.maxHp === 11, `prévia: PV 11 (teve ${preview.character?.maxHp})`);
  ok(preview.character.abilities.dex === 17, 'prévia: DES 17');

  let lastRoll = null, lastChat = null, lastSystem = null;
  dm.on('log:entry', (e) => { if (e.type === 'roll') lastRoll = e; if (e.type === 'chat') lastChat = e; if (e.type === 'system') lastSystem = e; });

  const saved = await new Promise((res) => player.emit('character:save', { raw: rawChar }, res));
  ok(saved.ok && saved.characterId, 'ficha salva');
  await wait(150);
  ok(lastSystem && /criou/.test(lastSystem.text), 'log de criação publicado');
  const charId = saved.characterId;

  const gotRaw = await new Promise((res) => player.emit('character:raw', { characterId: charId }, res));
  ok(gotRaw.ok && gotRaw.raw.name === 'Aria Folha-Prata', 'raw recuperado para edição');

  const npc = await new Promise((res) => dm.emit('character:save', { raw: { name: 'Goblin', raceKey: 'half_orc', classKey: 'barbarian', isNPC: true, baseAbilities: { str: 14, dex: 12, con: 13, int: 8, wis: 10, cha: 8 } } }, res));
  ok(npc.ok, 'mestre cria NPC');
  const npcDenied = await new Promise((res) => player.emit('character:raw', { characterId: npc.characterId }, res));
  ok(!npcDenied.ok, 'jogador não acessa raw do NPC do mestre');

  const check = await new Promise((res) => player.emit('roll:check', { modifier: 5, mode: 'advantage', label: 'Furtividade' }, res));
  ok(check.ok && check.entry.result.mode === 'advantage', 'rolagem de teste com vantagem');
  await wait(100);
  ok(lastRoll && lastRoll.kind === 'check', 'log de rolagem publicado');

  const free = await new Promise((res) => player.emit('roll:freeform', { expression: '2d6+3', label: 'Dano' }, res));
  ok(free.ok && free.entry.result.total >= 5, 'rolagem livre 2d6+3');

  player.emit('chat:send', 'Vamos com cuidado…');
  await wait(120);
  ok(lastChat && lastChat.text === 'Vamos com cuidado…', 'chat entregue');

  const scene = await new Promise((res) => dm.emit('scene:set', 'Vocês entram na cripta gélida.', res));
  ok(scene.ok, 'mestre define a cena');
  const sceneDenied = await new Promise((res) => player.emit('scene:set', 'hack', res));
  ok(!sceneDenied.ok, 'jogador não define cena');

  await new Promise((res) => player.emit('character:save', { raw: { currentHp: 4 }, targetCharId: charId }, res));
  let stateAfter = null;
  dm.on('room:state', (s) => { stateAfter = s; });
  await wait(150);
  const myChar = stateAfter?.characters.find(c => c.id === charId);
  ok(myChar && myChar.currentHp === 4, `PV atualizado para 4 (teve ${myChar?.currentHp})`);

  const paused = await new Promise((res) => dm.emit('session:pause', res));
  ok(paused.ok, 'sessão pausada');
  await wait(200);
  const resumed = await new Promise((res) => dm.emit('room:resume', { code }, res));
  ok(resumed.ok, 'sessão retomada pelo mestre');
  ok(resumed.state.characters.length === 2, 'personagens preservados ao retomar');
  ok(resumed.state.name === 'A Cripta Sombria', 'nome da campanha preservado');

  dm.close(); player.close();
} catch (e) {
  fail++; console.log('  ✗ EXCEÇÃO:', e.message, e.stack);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} Integração: ${pass} passaram, ${fail} falharam`);
server.kill('SIGKILL');
process.exit(fail === 0 ? 0 : 1);
