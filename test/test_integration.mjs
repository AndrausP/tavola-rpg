// test/test_integration.mjs
import { io } from 'socket.io-client';
import { spawn } from 'child_process';

const PORT = 3998;
const server = spawn('node', ['server.js'], { env: { ...process.env, PORT }, stdio: 'pipe' });
await new Promise((r) => server.stdout.on('data', (d) => { if (d.toString().includes('rodando')) r(); }));

const URL = `http://localhost:${PORT}`;
const conn = () => io(URL, { transports: ['websocket'] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗', m)); };

try {
  const dm = conn(); const player = conn();
  await wait(300);

  // mestre cria mesa
  const dmProfile = { id: 'dm-test', name: 'Mestre Test', avatar: '👑' };
  const created = await new Promise((res) => dm.emit('room:create', {
    profile: dmProfile,
    config: { name: 'A Cripta Sombria', levelStart: 1, abilityMethod: 'standard_array', maxPlayers: 4 },
  }, res));
  ok(created.ok && created.code?.length === 5, 'mesa criada com código de 5 chars');
  ok(created.role === 'dm', 'criador é mestre');
  const code = created.code;

  // jogador entra
  const joined = await new Promise((res) => player.emit('room:join', {
    code, profile: { id: 'pl-test', name: 'Aria', avatar: '🧝' },
  }, res));
  ok(joined.ok && joined.role === 'player', 'jogador entrou');
  ok(joined.state.members.length === 2, 'mesa com 2 membros');

  // prévia de ficha
  const rawChar = {
    name: 'Aria Folha-Prata', raceKey: 'elf', subraceKey: 'wood_elf', classKey: 'ranger', level: 1,
    baseAbilities: { str: 10, dex: 15, con: 13, int: 12, wis: 14, cha: 8 },
    backgroundKey: 'outlander', skillProficiencies: ['athletics', 'survival', 'stealth', 'perception', 'nature'],
    color: '#3d8b5f',
  };
  const preview = await new Promise((res) => player.emit('character:preview', rawChar, res));
  ok(preview.ok && preview.character.maxHp === 11, `prévia: PV 11 (teve ${preview.character?.maxHp})`); // d10 + CON1
  ok(preview.character.abilities.dex === 17, 'prévia: DES 17 (elfo+2, floresta n/a a DES)');

  // listeners de log
  let lastRoll = null, lastChat = null, lastSystem = null;
  dm.on('log:entry', (e) => { if (e.type === 'roll') lastRoll = e; if (e.type === 'chat') lastChat = e; if (e.type === 'system') lastSystem = e; });

  // jogador salva ficha
  const saved = await new Promise((res) => player.emit('character:save', { raw: rawChar }, res));
  ok(saved.ok && saved.characterId, 'ficha salva');
  await wait(150);
  ok(lastSystem && /criou/.test(lastSystem.text), 'log de criação publicado');
  const charId = saved.characterId;

  // buscar raw para edição
  const gotRaw = await new Promise((res) => player.emit('character:raw', { characterId: charId }, res));
  ok(gotRaw.ok && gotRaw.raw.name === 'Aria Folha-Prata', 'raw recuperado para edição');

  // jogador NÃO pode buscar raw de outro? (cria um NPC pelo DM)
  const npc = await new Promise((res) => dm.emit('character:save', { raw: { name: 'Goblin', raceKey: 'half_orc', classKey: 'barbarian', isNPC: true, baseAbilities: { str: 14, dex: 12, con: 13, int: 8, wis: 10, cha: 8 } } }, res));
  ok(npc.ok, 'mestre cria NPC');
  const npcDenied = await new Promise((res) => player.emit('character:raw', { characterId: npc.characterId }, res));
  ok(!npcDenied.ok, 'jogador não acessa raw do NPC do mestre');

  // rolagem de teste (skill)
  const check = await new Promise((res) => player.emit('roll:check', { modifier: 5, mode: 'advantage', label: 'Furtividade' }, res));
  ok(check.ok && check.entry.result.mode === 'advantage', 'rolagem de teste com vantagem');
  await wait(100);
  ok(lastRoll && lastRoll.kind === 'check', 'log de rolagem publicado');

  // rolagem livre
  const free = await new Promise((res) => player.emit('roll:freeform', { expression: '2d6+3', label: 'Dano' }, res));
  ok(free.ok && free.entry.result.total >= 5, 'rolagem livre 2d6+3');

  // chat
  player.emit('chat:send', 'Vamos com cuidado…');
  await wait(120);
  ok(lastChat && lastChat.text === 'Vamos com cuidado…', 'chat entregue');

  // cena (mestre)
  const scene = await new Promise((res) => dm.emit('scene:set', 'Vocês entram na cripta gélida.', res));
  ok(scene.ok, 'mestre define a cena');

  // jogador não define cena
  const sceneDenied = await new Promise((res) => player.emit('scene:set', 'hack', res));
  ok(!sceneDenied.ok, 'jogador não define cena');

  // edição de PV
  await new Promise((res) => player.emit('character:save', { raw: { currentHp: 4 }, targetCharId: charId }, res));
  let stateAfter = null;
  dm.on('room:state', (s) => { stateAfter = s; });
  await wait(150);
  const myChar = stateAfter?.characters.find(c => c.id === charId);
  ok(myChar && myChar.currentHp === 4, `PV atualizado para 4 (teve ${myChar?.currentHp})`);

  // pausar e retomar
  const paused = await new Promise((res) => dm.emit('session:pause', res));
  ok(paused.ok, 'sessão pausada');
  await wait(200);
  const resumed = await new Promise((res) => dm.emit('room:resume', { profile: dmProfile, code }, res));
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
