// src/srd.js
// Dados do D&D 5e baseados no SRD (System Reference Document — conteúdo aberto OGL/CC-BY-4.0).
// Foco em criação de personagem nível 1–20 jogável.

export const ABILITIES = [
  { key: 'str', name: 'Força', short: 'FOR' },
  { key: 'dex', name: 'Destreza', short: 'DES' },
  { key: 'con', name: 'Constituição', short: 'CON' },
  { key: 'int', name: 'Inteligência', short: 'INT' },
  { key: 'wis', name: 'Sabedoria', short: 'SAB' },
  { key: 'cha', name: 'Carisma', short: 'CAR' },
];

export const SKILLS = [
  { key: 'acrobatics', name: 'Acrobacia', ability: 'dex' },
  { key: 'animal_handling', name: 'Adestrar Animais', ability: 'wis' },
  { key: 'arcana', name: 'Arcanismo', ability: 'int' },
  { key: 'athletics', name: 'Atletismo', ability: 'str' },
  { key: 'deception', name: 'Enganação', ability: 'cha' },
  { key: 'history', name: 'História', ability: 'int' },
  { key: 'insight', name: 'Intuição', ability: 'wis' },
  { key: 'intimidation', name: 'Intimidação', ability: 'cha' },
  { key: 'investigation', name: 'Investigação', ability: 'int' },
  { key: 'medicine', name: 'Medicina', ability: 'wis' },
  { key: 'nature', name: 'Natureza', ability: 'int' },
  { key: 'perception', name: 'Percepção', ability: 'wis' },
  { key: 'performance', name: 'Atuação', ability: 'cha' },
  { key: 'persuasion', name: 'Persuasão', ability: 'cha' },
  { key: 'religion', name: 'Religião', ability: 'int' },
  { key: 'sleight_of_hand', name: 'Prestidigitação', ability: 'dex' },
  { key: 'stealth', name: 'Furtividade', ability: 'dex' },
  { key: 'survival', name: 'Sobrevivência', ability: 'wis' },
];

export const ALIGNMENTS = [
  'Leal e Bom', 'Neutro e Bom', 'Caótico e Bom',
  'Leal e Neutro', 'Neutro', 'Caótico e Neutro',
  'Leal e Mau', 'Neutro e Mau', 'Caótico e Mau',
];

export const RACES = [
  {
    key: 'human', name: 'Humano', emoji: '🧑',
    desc: 'Versáteis e ambiciosos, os humanos se adaptam a qualquer caminho.',
    speed: 9, size: 'Médio',
    abilityBonuses: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 },
    traits: ['Versatilidade humana: +1 em todos os atributos.'],
    languages: ['Comum', '+1 idioma à escolha'],
  },
  {
    key: 'elf', name: 'Elfo', emoji: '🧝',
    desc: 'Graciosos e longevos, ligados à magia e à natureza.',
    speed: 9, size: 'Médio',
    abilityBonuses: { dex: 2 },
    traits: ['Visão no escuro 18m', 'Sentidos Aguçados (Percepção)', 'Ancestral Feérico (vantagem vs. enfeitiçado)', 'Transe (4h de meditação)'],
    languages: ['Comum', 'Élfico'],
    subraces: [
      { key: 'high_elf', name: 'Alto Elfo', abilityBonuses: { int: 1 }, traits: ['Um truque de mago', 'Treinamento com armas élficas'] },
      { key: 'wood_elf', name: 'Elfo da Floresta', abilityBonuses: { wis: 1 }, speed: 10, traits: ['Pés Ligeiros (deslocamento 10,5m)', 'Máscara da Natureza (esconder na natureza)'] },
    ],
  },
  {
    key: 'dwarf', name: 'Anão', emoji: '🧔',
    desc: 'Robustos e resistentes, mestres da pedra e do metal.',
    speed: 7.5, size: 'Médio',
    abilityBonuses: { con: 2 },
    traits: ['Visão no escuro 18m', 'Resistência Anã (vantagem vs. veneno)', 'Treinamento de Combate Anão', 'Proficiência com ferramentas de artesão'],
    languages: ['Comum', 'Anão'],
    subraces: [
      { key: 'hill_dwarf', name: 'Anão da Colina', abilityBonuses: { wis: 1 }, traits: ['Tenacidade Anã (+1 PV por nível)'] },
      { key: 'mountain_dwarf', name: 'Anão da Montanha', abilityBonuses: { str: 2 }, traits: ['Treinamento com Armadura Anã (leve e média)'] },
    ],
  },
  {
    key: 'halfling', name: 'Halfling', emoji: '🧒',
    desc: 'Pequenos, sortudos e corajosos apesar do tamanho.',
    speed: 7.5, size: 'Pequeno',
    abilityBonuses: { dex: 2 },
    traits: ['Sortudo (rerrola 1 natural)', 'Bravura (vantagem vs. amedrontado)', 'Agilidade Halfling (passa por criaturas maiores)'],
    languages: ['Comum', 'Halfling'],
    subraces: [
      { key: 'lightfoot', name: 'Pés Leves', abilityBonuses: { cha: 1 }, traits: ['Furtividade Natural'] },
      { key: 'stout', name: 'Robusto', abilityBonuses: { con: 1 }, traits: ['Resiliência Robusta (vantagem vs. veneno)'] },
    ],
  },
  {
    key: 'dragonborn', name: 'Draconato', emoji: '🐲',
    desc: 'Descendentes de dragões, com sopro elemental e orgulho de clã.',
    speed: 9, size: 'Médio',
    abilityBonuses: { str: 2, cha: 1 },
    traits: ['Ancestral Dracônico (escolha o tipo de dano)', 'Arma de Sopro (3d6 na criação)', 'Resistência a dano dracônico'],
    languages: ['Comum', 'Dracônico'],
  },
  {
    key: 'gnome', name: 'Gnomo', emoji: '🧙',
    desc: 'Curiosos e inventivos, cheios de energia e engenhosidade.',
    speed: 7.5, size: 'Pequeno',
    abilityBonuses: { int: 2 },
    traits: ['Visão no escuro 18m', 'Astúcia Gnômica (vantagem em testes mentais vs. magia)'],
    languages: ['Comum', 'Gnômico'],
    subraces: [
      { key: 'forest_gnome', name: 'Gnomo da Floresta', abilityBonuses: { dex: 1 }, traits: ['Truque Menor Ilusão', 'Falar com Pequenos Animais'] },
      { key: 'rock_gnome', name: 'Gnomo das Rochas', abilityBonuses: { con: 1 }, traits: ['Conhecimento de Artífice', 'Engenhoqueiro'] },
    ],
  },
  {
    key: 'half_elf', name: 'Meio-Elfo', emoji: '🧝‍♂️',
    desc: 'Entre dois mundos, carismáticos e adaptáveis.',
    speed: 9, size: 'Médio',
    abilityBonuses: { cha: 2 },
    traits: ['+1 em dois atributos à escolha', 'Visão no escuro 18m', 'Ancestral Feérico', 'Versatilidade em Perícia (2 perícias à escolha)'],
    languages: ['Comum', 'Élfico', '+1 idioma'],
    chooseAbilities: { count: 2, amount: 1, exclude: ['cha'] },
  },
  {
    key: 'half_orc', name: 'Meio-Orc', emoji: '👹',
    desc: 'Fortes e ferozes, sobreviventes natos.',
    speed: 9, size: 'Médio',
    abilityBonuses: { str: 2, con: 1 },
    traits: ['Visão no escuro 18m', 'Ameaçador (proficiência em Intimidação)', 'Resistência Implacável (cai a 1 PV em vez de 0, 1x/descanso)', 'Ataques Selvagens (crítico extra)'],
    languages: ['Comum', 'Orc'],
  },
  {
    key: 'tiefling', name: 'Tiefling', emoji: '😈',
    desc: 'Marcados por sangue infernal, astutos e resilientes.',
    speed: 9, size: 'Médio',
    abilityBonuses: { int: 1, cha: 2 },
    traits: ['Visão no escuro 18m', 'Resistência Infernal (resistência a fogo)', 'Legado Infernal (truque Taumaturgia)'],
    languages: ['Comum', 'Infernal'],
  },
];

// Helper p/ features comuns
const ARMOR = { none: 'Nenhuma', light: 'Leve', medium: 'Média', heavy: 'Pesada', shield: 'Escudos' };

export const CLASSES = [
  {
    key: 'barbarian', name: 'Bárbaro', emoji: '🪓', hitDie: 12,
    desc: 'Um guerreiro feroz movido pela fúria do combate.',
    primary: ['str'], savingThrows: ['str', 'con'],
    armor: ['light', 'medium', 'shield'], weapons: ['Armas simples', 'Armas marciais'],
    skillCount: 2, skillsFrom: ['animal_handling', 'athletics', 'intimidation', 'nature', 'perception', 'survival'],
    level1: ['Fúria', 'Defesa sem Armadura (CA = 10 + DES + CON)'],
  },
  {
    key: 'bard', name: 'Bardo', emoji: '🎵', hitDie: 8,
    desc: 'Um artista mágico cujas palavras e música inspiram aliados.',
    primary: ['cha'], savingThrows: ['dex', 'cha'],
    armor: ['light'], weapons: ['Armas simples', 'Bestas de mão', 'Espadas longas', 'Floretes', 'Rapieiras'],
    skillCount: 3, skillsFrom: SKILLS.map(s => s.key),
    spellcasting: 'cha',
    level1: ['Conjuração', 'Inspiração de Bardo (d6)'],
  },
  {
    key: 'cleric', name: 'Clérigo', emoji: '✨', hitDie: 8,
    desc: 'Um campeão divino que empunha a magia dos deuses.',
    primary: ['wis'], savingThrows: ['wis', 'cha'],
    armor: ['light', 'medium', 'shield'], weapons: ['Armas simples'],
    skillCount: 2, skillsFrom: ['history', 'insight', 'medicine', 'persuasion', 'religion'],
    spellcasting: 'wis',
    level1: ['Conjuração', 'Domínio Divino'],
  },
  {
    key: 'druid', name: 'Druida', emoji: '🌿', hitDie: 8,
    desc: 'Um sacerdote da natureza que canaliza poderes primais.',
    primary: ['wis'], savingThrows: ['int', 'wis'],
    armor: ['light', 'medium', 'shield'], weapons: ['Clavas', 'Adagas', 'Dardos', 'Azagaias', 'Maças', 'Bordões', 'Cimitarras', 'Foices', 'Fundas', 'Lanças'],
    skillCount: 2, skillsFrom: ['arcana', 'animal_handling', 'insight', 'medicine', 'nature', 'perception', 'religion', 'survival'],
    spellcasting: 'wis',
    level1: ['Conjuração', 'Druídico (idioma)'],
  },
  {
    key: 'fighter', name: 'Guerreiro', emoji: '⚔️', hitDie: 10,
    desc: 'Um mestre do combate marcial, hábil com armas e armaduras.',
    primary: ['str', 'dex'], savingThrows: ['str', 'con'],
    armor: ['light', 'medium', 'heavy', 'shield'], weapons: ['Armas simples', 'Armas marciais'],
    skillCount: 2, skillsFrom: ['acrobatics', 'animal_handling', 'athletics', 'history', 'insight', 'intimidation', 'perception', 'survival'],
    level1: ['Estilo de Luta', 'Retomar o Fôlego'],
  },
  {
    key: 'monk', name: 'Monge', emoji: '👊', hitDie: 8,
    desc: 'Um artista marcial que canaliza a energia do corpo (ki).',
    primary: ['dex', 'wis'], savingThrows: ['str', 'dex'],
    armor: [], weapons: ['Armas simples', 'Espadas curtas'],
    skillCount: 2, skillsFrom: ['acrobatics', 'athletics', 'history', 'insight', 'religion', 'stealth'],
    level1: ['Artes Marciais (d4)', 'Defesa sem Armadura (CA = 10 + DES + SAB)'],
  },
  {
    key: 'paladin', name: 'Paladino', emoji: '🛡️', hitDie: 10,
    desc: 'Um guerreiro sagrado ligado por um juramento.',
    primary: ['str', 'cha'], savingThrows: ['wis', 'cha'],
    armor: ['light', 'medium', 'heavy', 'shield'], weapons: ['Armas simples', 'Armas marciais'],
    skillCount: 2, skillsFrom: ['athletics', 'insight', 'intimidation', 'medicine', 'persuasion', 'religion'],
    level1: ['Sentido Divino', 'Cura pelas Mãos'],
  },
  {
    key: 'ranger', name: 'Patrulheiro', emoji: '🏹', hitDie: 10,
    desc: 'Um caçador das fronteiras, mestre da natureza selvagem.',
    primary: ['dex', 'wis'], savingThrows: ['str', 'dex'],
    armor: ['light', 'medium', 'shield'], weapons: ['Armas simples', 'Armas marciais'],
    skillCount: 3, skillsFrom: ['animal_handling', 'athletics', 'insight', 'investigation', 'nature', 'perception', 'stealth', 'survival'],
    level1: ['Inimigo Favorito', 'Explorador Nato'],
  },
  {
    key: 'rogue', name: 'Ladino', emoji: '🗡️', hitDie: 8,
    desc: 'Um especialista em furtividade, truques e ataques precisos.',
    primary: ['dex'], savingThrows: ['dex', 'int'],
    armor: ['light'], weapons: ['Armas simples', 'Bestas de mão', 'Espadas longas', 'Floretes', 'Rapieiras', 'Espadas curtas'],
    skillCount: 4, skillsFrom: ['acrobatics', 'athletics', 'deception', 'insight', 'intimidation', 'investigation', 'perception', 'performance', 'persuasion', 'sleight_of_hand', 'stealth'],
    level1: ['Especialização', 'Ataque Furtivo (1d6)', 'Ladinagem (Gíria de Ladrão)'],
  },
  {
    key: 'sorcerer', name: 'Feiticeiro', emoji: '🔮', hitDie: 6,
    desc: 'Um conjurador cujo poder mágico vem do sangue ou do nascimento.',
    primary: ['cha'], savingThrows: ['con', 'cha'],
    armor: [], weapons: ['Adagas', 'Dardos', 'Fundas', 'Bordões', 'Bestas leves'],
    skillCount: 2, skillsFrom: ['arcana', 'deception', 'insight', 'intimidation', 'persuasion', 'religion'],
    spellcasting: 'cha',
    level1: ['Conjuração', 'Origem de Feitiçaria'],
  },
  {
    key: 'warlock', name: 'Bruxo', emoji: '👁️', hitDie: 8,
    desc: 'Um conjurador que fez um pacto com uma entidade poderosa.',
    primary: ['cha'], savingThrows: ['wis', 'cha'],
    armor: ['light'], weapons: ['Armas simples'],
    skillCount: 2, skillsFrom: ['arcana', 'deception', 'history', 'intimidation', 'investigation', 'nature', 'religion'],
    spellcasting: 'cha',
    level1: ['Patrono Transcendental', 'Magia de Pacto'],
  },
  {
    key: 'wizard', name: 'Mago', emoji: '📖', hitDie: 6,
    desc: 'Um estudioso da magia arcana, manipulando a realidade pelo saber.',
    primary: ['int'], savingThrows: ['int', 'wis'],
    armor: [], weapons: ['Adagas', 'Dardos', 'Fundas', 'Bordões', 'Bestas leves'],
    skillCount: 2, skillsFrom: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'religion'],
    spellcasting: 'int',
    level1: ['Conjuração', 'Recuperação Arcana'],
  },
];

export const BACKGROUNDS = [
  { key: 'acolyte', name: 'Acólito', skills: ['insight', 'religion'], desc: 'Você serviu em um templo, intermediando o sagrado e o mundano.', feature: 'Abrigo dos Fiéis' },
  { key: 'criminal', name: 'Criminoso', skills: ['deception', 'stealth'], desc: 'Você tem um histórico de quebrar a lei e contatos no submundo.', feature: 'Contato Criminoso' },
  { key: 'folk_hero', name: 'Herói do Povo', skills: ['animal_handling', 'survival'], desc: 'Você veio de origem humilde, mas é destinado a algo maior.', feature: 'Hospitalidade Rústica' },
  { key: 'noble', name: 'Nobre', skills: ['history', 'persuasion'], desc: 'Você nasceu em berço de privilégio, poder e responsabilidade.', feature: 'Posição de Privilégio' },
  { key: 'sage', name: 'Sábio', skills: ['arcana', 'history'], desc: 'Você passou anos estudando o saber do multiverso.', feature: 'Pesquisador' },
  { key: 'soldier', name: 'Soldado', skills: ['athletics', 'intimidation'], desc: 'A guerra foi sua vida; você conhece combate e disciplina.', feature: 'Patente Militar' },
  { key: 'charlatan', name: 'Charlatão', skills: ['deception', 'sleight_of_hand'], desc: 'Você sempre teve facilidade com as pessoas — e em enganá-las.', feature: 'Identidade Falsa' },
  { key: 'hermit', name: 'Eremita', skills: ['medicine', 'religion'], desc: 'Você viveu recluso, em busca de iluminação ou de um segredo.', feature: 'Descoberta' },
  { key: 'outlander', name: 'Forasteiro', skills: ['athletics', 'survival'], desc: 'Você cresceu nas terras selvagens, longe da civilização.', feature: 'Andarilho' },
  { key: 'entertainer', name: 'Artista', skills: ['acrobatics', 'performance'], desc: 'Você prospera diante de uma plateia, vivendo de seu talento.', feature: 'Pela Demanda Popular' },
];

// Métodos de geração de atributos
export const ABILITY_METHODS = {
  standard_array: { name: 'Conjunto Padrão', values: [15, 14, 13, 12, 10, 8] },
  point_buy: { name: 'Compra de Pontos', budget: 27, min: 8, max: 15 },
  manual: { name: 'Manual / Rolagem', min: 3, max: 20 },
};

// Custo da compra de pontos (point buy)
export const POINT_BUY_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

// Bônus de proficiência por nível
export function proficiencyBonus(level) {
  return Math.floor((level - 1) / 4) + 2;
}

// Média de PV por dado de vida (para níveis > 1)
export const HIT_DIE_AVG = { 6: 4, 8: 5, 10: 6, 12: 7 };

export const SRD = {
  ABILITIES, SKILLS, ALIGNMENTS, RACES, CLASSES, BACKGROUNDS,
  ABILITY_METHODS, POINT_BUY_COST, ARMOR,
};
