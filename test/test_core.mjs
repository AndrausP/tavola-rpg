// test/test_core.mjs
import { rollExpression, rollD20 } from '../src/dice.js';
import { computeCharacter, abilityMod } from '../src/Character.js';
import { Room } from '../src/Room.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗', m)); };

// ---------------- DADOS ----------------
console.log('• Dados');
const r1 = rollExpression('2d6+3');
ok(r1.ok && r1.total >= 5 && r1.total <= 15, '2d6+3 dentro de 5–15');
ok(r1.parts.length === 2, '2d6+3 tem 2 termos');

const r2 = rollExpression('4d6kh3');
ok(r2.ok && r2.parts[0].kept.length === 3, '4d6kh3 mantém 3 dados');
ok(r2.total >= 3 && r2.total <= 18, '4d6kh3 entre 3–18');

const r3 = rollExpression('1d20-1+2d4');
ok(r3.ok && r3.parts.length === 3, '1d20-1+2d4 tem 3 termos');

ok(!rollExpression('2d7').ok, 'd7 é inválido');
ok(!rollExpression('abc').ok, 'expressão sem dado é inválida');
ok(!rollExpression('200d6').ok, '200 dados excede o limite');

const adv = rollD20(5, 'advantage');
ok(adv.dice.length === 2 && adv.chosen === Math.max(...adv.dice), 'vantagem pega o maior');
ok(adv.total === adv.chosen + 5, 'vantagem soma modificador');
const dis = rollD20(0, 'disadvantage');
ok(dis.chosen === Math.min(...dis.dice), 'desvantagem pega o menor');

// modificador de atributo
ok(abilityMod(10) === 0 && abilityMod(16) === 3 && abilityMod(8) === -1, 'modificadores corretos');

// ---------------- FICHA: Humano Guerreiro ----------------
console.log('• Ficha — Humano Guerreiro');
const fighter = computeCharacter({
  name: 'Aldric', raceKey: 'human', classKey: 'fighter', level: 1,
  baseAbilities: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  skillProficiencies: ['athletics', 'perception'],
});
// Humano +1 em tudo: STR16 DEX15 CON14 INT13 WIS11 CHA9
ok(fighter.abilities.str === 16, `STR 16 (teve ${fighter.abilities.str})`);
ok(fighter.abilities.con === 14, `CON 14 (teve ${fighter.abilities.con})`);
ok(fighter.mods.str === 3, 'mod STR +3');
ok(fighter.maxHp === 12, `PV 12 = d10 + CON2 (teve ${fighter.maxHp})`);
ok(fighter.ac === 12, `CA 12 = 10 + DES2 (teve ${fighter.ac})`);
ok(fighter.saves.str.proficient && fighter.saves.str.mod === 5, 'save FOR proficiente = +5');
ok(fighter.saves.con.mod === 4, 'save CON = +4');
ok(!fighter.saves.dex.proficient, 'save DES não proficiente');
ok(fighter.skills.athletics.mod === 5, 'Atletismo +5 (FOR3 + prof2)');
ok(fighter.skills.perception.mod === 2, 'Percepção +2');
ok(fighter.passivePerception === 12, 'Percepção passiva 12');
ok(fighter.profBonus === 2, 'bônus de proficiência +2');

// ---------------- FICHA: Anão da Montanha (empilha bônus) ----------------
console.log('• Ficha — Anão da Montanha (raça + sub-raça)');
const dwarf = computeCharacter({
  name: 'Thrain', raceKey: 'dwarf', subraceKey: 'mountain_dwarf', classKey: 'barbarian', level: 1,
  baseAbilities: { str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 12 },
});
// Anão +CON2, Montanha +STR2 → STR17 CON16
ok(dwarf.abilities.str === 17, `STR 17 (anão montanha) (teve ${dwarf.abilities.str})`);
ok(dwarf.abilities.con === 16, `CON 16 (teve ${dwarf.abilities.con})`);
// Bárbaro: PV d12 + CON3 = 15; CA sem armadura = 10 + DES1 + CON3 = 14
ok(dwarf.maxHp === 15, `PV 15 (teve ${dwarf.maxHp})`);
ok(dwarf.ac === 14, `CA defesa sem armadura 14 (teve ${dwarf.ac})`);
ok(dwarf.speed === 7.5, 'deslocamento anão 7,5m');

// ---------------- FICHA: Anão da Colina PV+nível ----------------
const hillDwarf = computeCharacter({
  raceKey: 'dwarf', subraceKey: 'hill_dwarf', classKey: 'fighter', level: 3,
  baseAbilities: { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
});
// CON: 14+2(anão)=16 → mod +3. Guerreiro d10 nv3: 10+3 + 2*(6+3) = 13 + 18 = 31; +3 (colina, 1/nv) = 34
ok(hillDwarf.maxHp === 34, `Anão Colina Guerreiro Nv3 PV 34 (teve ${hillDwarf.maxHp})`);
ok(hillDwarf.profBonus === 2, 'prof bônus nv3 = +2');

// ---------------- FICHA: Mago (conjuração) ----------------
const wizard = computeCharacter({
  raceKey: 'elf', subraceKey: 'high_elf', classKey: 'wizard', level: 5,
  baseAbilities: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
});
// Alto Elfo: DEX+2, INT+1 → DEX16 INT16. INT mod +3. Prof nv5 +3.
ok(wizard.abilities.int === 16, 'Alto Elfo INT 16');
ok(wizard.profBonus === 3, 'prof bônus nv5 = +3');
ok(wizard.spellcasting === 'int', 'mago conjura por INT');
ok(wizard.spellSaveDC === 8 + 3 + 3, `CD de magia 14 (teve ${wizard.spellSaveDC})`);
ok(wizard.spellAttack === 3 + 3, `ataque mágico +6 (teve ${wizard.spellAttack})`);

// ---------------- MESA ----------------
console.log('• Mesa');
const room = new Room('ABCDE', 'dm1', { id: 'pdm', name: 'Mestre', avatar: '👑' }, { name: 'A Cripta' });
ok(room.isDM('dm1'), 'criador é mestre');
const dmMember = room.addMember('dm1', { id: 'pdm', name: 'Mestre' }, 'dm');
const pl = room.addMember('p2', { id: 'pp2', name: 'Bia' }, 'player');
ok(pl.role === 'player' && pl.color !== '#d4af37', 'jogador tem cor própria (não dourada)');

// jogador cria personagem
const save = room.upsertCharacter('p2', {
  name: 'Lyra', raceKey: 'wood_elf', classKey: 'ranger', level: 1,
  baseAbilities: { str: 10, dex: 15, con: 13, int: 12, wis: 14, cha: 8 },
  skillProficiencies: ['stealth', 'survival', 'perception'],
});
ok(save.character && save.character.name === 'Lyra', 'personagem criado');
ok(pl.characterId === save.characterId, 'personagem vinculado ao jogador');

// jogador não pode editar personagem dos outros
const npc = room.upsertCharacter('dm1', { name: 'Goblin', raceKey: 'human', classKey: 'barbarian', isNPC: true, baseAbilities: {} });
const hack = room.upsertCharacter('p2', { name: 'Hackeado' }, npc.characterId);
ok(hack.error, 'jogador não edita personagem alheio');

// DM pode editar qualquer um
const dmEdit = room.upsertCharacter('dm1', { name: 'Lyra Editada' }, save.characterId);
ok(!dmEdit.error && dmEdit.character.name === 'Lyra Editada', 'mestre edita personagem do jogador');

// rolagens
const roll = room.rollFreeform('p2', '1d20+5', 'Ataque');
ok(roll && roll.result.total >= 6, 'rolagem livre funciona');
const check = room.rollCheck('p2', { skillKey: 'stealth', label: 'Furtividade', modifier: 4, mode: 'advantage' });
ok(check && check.result.mode === 'advantage', 'rolagem de teste com vantagem');

// bloqueio de rolagem de jogador
room.updateConfig('dm1', { allowPlayerRolls: false });
const blocked = room.rollFreeform('p2', '1d20');
ok(blocked.error, 'mestre bloqueia rolagem dos jogadores');
ok(!room.rollFreeform('dm1', '1d20').error, 'mestre ainda rola');

// chat
ok(room.addChat('p2', 'salve mestre'), 'chat funciona');

// snapshot + restore
const snap = room.snapshot();
ok(snap.characters.length === 2 && snap.name === 'A Cripta', 'snapshot guarda personagens');
const restored = Room.restore('ABCDE', snap, 'dmNew', { id: 'pdm', name: 'Mestre' });
ok(restored.characters.size === 2, 'restauração recria personagens');
ok(restored.getCharacter(save.characterId)?.name === 'Lyra Editada', 'personagem restaurado com dados certos');

console.log(`\n${fail === 0 ? '✅' : '❌'} Núcleo: ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
