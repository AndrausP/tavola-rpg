// public/js/builder.js
// Assistente de criação de personagem D&D 5e — 6 etapas com prévia ao vivo.

const Builder = (() => {
  const PORTRAITS = ['🧙','🧝','🧔','🧒','🦹','🧚','🤴','👸','🧛','🧟','🐉','⚔️','🏹','🗡️','🛡️','🪄','🔮','🐺','🦅','😈','👹','🧞','🥷','🧌'];
  const COLORS = ['#b5482e','#2e6f9e','#3d8b5f','#8a5fb5','#c2872b','#a83a5b','#4a7a7a','#7a6a3a','#9e4a2e','#5f5fb5'];
  const STEPS = [
    { key: 'identity', label: 'Identidade' },
    { key: 'race', label: 'Raça' },
    { key: 'class', label: 'Classe' },
    { key: 'abilities', label: 'Atributos' },
    { key: 'skills', label: 'Perícias' },
    { key: 'review', label: 'Revisão' },
  ];

  let socket = null;
  let S = null; // estado

  const esc = (s) => (s ?? '').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const $ = (s) => document.querySelector(s);

  function init(sock) { socket = sock; }

  function open({ config, existingRaw, onComplete }) {
    const level = config?.levelStart || 1;
    const method = config?.abilityMethod || 'standard_array';
    const isSeed = existingRaw?._isSeed;
    const editing = !!existingRaw && !isSeed;
    if (existingRaw) delete existingRaw._isSeed;
    S = {
      config: config || {}, method, onComplete,
      editing,
      targetCharId: editing ? (existingRaw?.id || null) : null,
      step: 0,
      raw: existingRaw ? deepClone(existingRaw) : {
        name: '', photo: null, color: COLORS[0], alignment: 'Neutro',
        backgroundKey: null, raceKey: null, subraceKey: null, classKey: null,
        baseAbilities: defaultAbilities(method),
        chosenAbilityBonuses: {}, skillProficiencies: [], level,
      },
    };
    if (!S.raw.level) S.raw.level = level;
    $('#builder-title').textContent = S.editing ? 'Editar Personagem' : 'Criar Personagem';
    showScreen('screen-builder');
    render();
  }

  function defaultAbilities(method) {
    if (method === 'point_buy') return { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
    if (method === 'standard_array') return { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
    return { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  }

  // ---------------- Render principal ----------------
  function render() {
    renderStepper();
    renderStep();
    renderPreview();
    const prev = $('#builder-prev'), next = $('#builder-next');
    prev.disabled = S.step === 0;
    next.textContent = S.step === STEPS.length - 1 ? (S.editing ? '✓ Salvar alterações' : '✓ Criar personagem') : 'Próximo ›';
  }

  function renderStepper() {
    $('#stepper').innerHTML = STEPS.map((s, i) =>
      `<span class="step-dot ${i === S.step ? 'active' : ''} ${i < S.step ? 'done' : ''}">${i + 1}. ${s.label}</span>`
    ).join('');
  }

  function renderStep() {
    const host = $('#builder-step');
    const key = STEPS[S.step].key;
    if (key === 'identity') host.innerHTML = stepIdentity();
    else if (key === 'race') host.innerHTML = stepRace();
    else if (key === 'class') host.innerHTML = stepClass();
    else if (key === 'abilities') host.innerHTML = stepAbilities();
    else if (key === 'skills') host.innerHTML = stepSkills();
    else if (key === 'review') { stepReview(host); return; }
    wireStep(key);
  }

  // ================= ETAPA: IDENTIDADE =================
  function stepIdentity() {
    const r = S.raw;
    const safeP = Engine.safePhoto(r.photo);
    const portraitHtml = (safeP && safeP.startsWith('data:'))
      ? `<div class="pv-portrait" style="background-image:url('${safeP}')"></div>`
      : `<div class="pv-portrait">${esc((safeP && !safeP.startsWith('data:')) ? safeP : '🧙')}</div>`;
    return `
      <h2 class="step-title">Quem é o herói?</h2>
      <p class="step-hint">Dê nome, rosto e essência ao seu personagem.</p>
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
        <div id="id-portrait" style="cursor:pointer" title="Trocar retrato">
          ${portraitHtml}
        </div>
        <div style="flex:1;min-width:200px">
          <input id="id-name" class="ink-input" type="text" maxlength="40" placeholder="Nome do personagem" value="${esc(r.name)}" />
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn-outline btn-sm" id="id-photo-btn">📷 Enviar foto</button>
            <input type="file" id="id-photo-file" accept="image/*" hidden />
          </div>
        </div>
      </div>

      <label class="ink-label" style="color:var(--gold-bright)">Retratos</label>
      <div class="avatar-grid" id="id-portraits">
        ${PORTRAITS.map(p => `<div class="avatar-opt ${r.photo === p ? 'selected' : ''}" data-p="${esc(p)}">${esc(p)}</div>`).join('')}
      </div>

      <label class="ink-label" style="color:var(--gold-bright)">Cor do personagem</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${COLORS.map(c => `<div class="color-swatch ${r.color === c ? 'sel' : ''}" data-c="${c}" style="width:32px;height:32px;border-radius:50%;background:${c};cursor:pointer;border:3px solid ${r.color === c ? '#e8c860' : 'transparent'}"></div>`).join('')}
      </div>

      <div class="form-grid" style="margin-top:8px">
        <div>
          <label class="ink-label" style="color:var(--gold-bright)">Tendência</label>
          <select id="id-align" class="ink-input">
            ${Engine.alignments.map(a => `<option ${r.alignment === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}
          </select>
        </div>
      </div>

      <label class="ink-label" style="color:var(--gold-bright)">Antecedente</label>
      <div class="choice-grid">
        ${Engine.backgrounds.map(b => `
          <div class="choice-card ${r.backgroundKey === b.key ? 'selected' : ''}" data-bg="${b.key}">
            <div class="choice-name" style="font-size:.92rem">${esc(b.name)}</div>
            <div class="choice-tag">${b.skills.map(s => Engine.skill(s)?.name).join(' · ')}</div>
            <div class="choice-desc">${esc(b.desc)}</div>
          </div>`).join('')}
      </div>`;
  }

  // ================= ETAPA: RAÇA =================
  function stepRace() {
    const r = S.raw;
    const allowed = S.config.allowedRaces;
    const races = Engine.races.filter(x => !allowed || allowed.includes(x.key));
    const race = Engine.race(r.raceKey);
    let detail = '';
    if (race) {
      const bonusStr = Object.entries(race.abilityBonuses || {})
        .map(([k, v]) => `${Engine.abilities.find(a => a.key === k).short} ${Engine.signed(v)}`).join(', ');
      detail = `
        <div class="parchment" style="margin-top:16px">
          <h3 class="ornate" style="font-size:1.1rem">${esc(race.name)}</h3>
          <p style="color:var(--ink-soft);font-style:italic;text-align:center;margin-bottom:10px">${esc(race.desc)}</p>
          <p style="color:var(--ink)"><b>Atributos:</b> ${esc(bonusStr || '—')} · <b>Deslocamento:</b> ${race.speed}m · <b>Tamanho:</b> ${esc(race.size)}</p>
          <p style="color:var(--ink);margin-top:6px"><b>Idiomas:</b> ${(race.languages || []).map(esc).join(', ')}</p>
          <div style="margin-top:10px"><b style="color:var(--blood)">Traços:</b>
            <ul style="margin:6px 0 0 18px;color:var(--ink)">${(race.traits || []).map(t => `<li>${esc(t)}</li>`).join('')}</ul>
          </div>
          ${race.subraces ? `
            <label class="ink-label" style="color:var(--blood);margin-top:14px">Linhagem</label>
            <div class="choice-grid">
              ${race.subraces.map(sr => {
                const sb = Object.entries(sr.abilityBonuses || {}).map(([k, v]) => `${Engine.abilities.find(a => a.key === k).short} ${Engine.signed(v)}`).join(', ');
                return `<div class="choice-card ${r.subraceKey === sr.key ? 'selected' : ''}" data-sub="${sr.key}">
                  <div class="choice-name" style="font-size:.92rem">${esc(sr.name)}</div>
                  <div class="choice-tag">${esc(sb)}</div>
                  <div class="choice-desc">${(sr.traits || []).map(esc).join(' · ')}</div>
                </div>`;
              }).join('')}
            </div>` : ''}
          ${race.chooseAbilities ? `<p style="margin-top:10px;color:var(--blood)"><b>+${race.chooseAbilities.amount}</b> em ${race.chooseAbilities.count} atributos à sua escolha — defina na etapa de Atributos.</p>` : ''}
        </div>`;
    }
    return `
      <h2 class="step-title">Escolha a Raça</h2>
      <p class="step-hint">A origem do seu personagem molda corpo e talentos.</p>
      <div class="choice-grid">
        ${races.map(x => `
          <div class="choice-card ${r.raceKey === x.key ? 'selected' : ''}" data-race="${x.key}">
            <div class="choice-emoji">${x.emoji}</div>
            <div class="choice-name">${esc(x.name)}</div>
          </div>`).join('')}
      </div>
      ${detail}`;
  }

  // ================= ETAPA: CLASSE =================
  function stepClass() {
    const r = S.raw;
    const allowed = S.config.allowedClasses;
    const classes = Engine.classes.filter(x => !allowed || allowed.includes(x.key));
    const k = Engine.klass(r.classKey);
    let detail = '';
    if (k) {
      detail = `
        <div class="parchment" style="margin-top:16px">
          <h3 class="ornate" style="font-size:1.1rem">${k.emoji} ${esc(k.name)}</h3>
          <p style="color:var(--ink-soft);font-style:italic;text-align:center;margin-bottom:10px">${esc(k.desc)}</p>
          <p style="color:var(--ink)"><b>Dado de Vida:</b> d${k.hitDie} · <b>Atributo principal:</b> ${k.primary.map(p => Engine.abilities.find(a => a.key === p).name).join('/')}</p>
          <p style="color:var(--ink);margin-top:6px"><b>Resistências:</b> ${k.savingThrows.map(s => Engine.abilities.find(a => a.key === s).name).join(', ')}</p>
          <p style="color:var(--ink);margin-top:6px"><b>Perícias:</b> escolha ${k.skillCount} entre ${k.skillsFrom.length === Engine.skills.length ? 'qualquer uma' : k.skillsFrom.map(s => Engine.skill(s).name).join(', ')}</p>
          <div style="margin-top:10px"><b style="color:var(--blood)">No nível 1:</b>
            <ul style="margin:6px 0 0 18px;color:var(--ink)">${k.level1.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
          </div>
        </div>`;
    }
    return `
      <h2 class="step-title">Escolha a Classe</h2>
      <p class="step-hint">A vocação que define como seu herói enfrenta o mundo.</p>
      <div class="choice-grid">
        ${classes.map(x => `
          <div class="choice-card ${r.classKey === x.key ? 'selected' : ''}" data-class="${x.key}">
            <div class="choice-emoji">${x.emoji}</div>
            <div class="choice-name">${esc(x.name)}</div>
            <div class="choice-tag">d${x.hitDie}</div>
          </div>`).join('')}
      </div>
      ${detail}`;
  }

  // ================= ETAPA: ATRIBUTOS =================
  function stepAbilities() {
    const r = S.raw;
    const method = S.method;
    const bonuses = Engine.abilityBonuses(r);
    const methodName = Engine.srd.ABILITY_METHODS[method]?.name || method;

    let pool = '';
    if (method === 'point_buy') {
      const spent = Object.values(r.baseAbilities).reduce((a, s) => a + Engine.pointBuyCost(s), 0);
      pool = `<div class="point-pool">Pontos restantes: <b>${27 - spent}</b> / 27</div>`;
    }

    const rows = Engine.abilities.map(a => {
      const base = r.baseAbilities[a.key] ?? 10;
      const bonus = bonuses[a.key] || 0;
      const total = base + bonus;
      const mod = Engine.abilityMod(total);
      let control = '';
      if (method === 'standard_array') {
        const arr = Engine.srd.ABILITY_METHODS.standard_array.values;
        control = `<select class="ab-select" data-ab="${a.key}">
          ${arr.map(v => `<option value="${v}" ${base === v ? 'selected' : ''}>${v}</option>`).join('')}
        </select>`;
      } else {
        control = `<div class="ab-controls">
          <button class="ab-btn" data-ab="${a.key}" data-d="-1">−</button>
          <span class="ab-score">${base}</span>
          <button class="ab-btn" data-ab="${a.key}" data-d="1">+</button>
        </div>`;
      }
      return `<div class="ability-row">
        <div class="ab-name">${a.name}<small>${a.short}</small></div>
        ${control}
        <div class="ab-bonus">${bonus ? Engine.signed(bonus) : ''}</div>
        <div class="ab-total">${total} <small>(${Engine.signed(mod)})</small></div>
      </div>`;
    }).join('');

    // bônus flexível (meio-elfo etc.)
    let flexible = '';
    const race = Engine.race(r.raceKey);
    if (race?.chooseAbilities) {
      const ca = race.chooseAbilities;
      const chosen = Object.keys(r.chosenAbilityBonuses || {});
      flexible = `<div class="parchment" style="margin-top:14px">
        <label class="ink-label" style="color:var(--blood)">Bônus racial à escolha — +${ca.amount} em ${ca.count} atributos</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${Engine.abilities.filter(a => !(ca.exclude || []).includes(a.key)).map(a => `
            <button class="btn-outline btn-sm flex-ab ${chosen.includes(a.key) ? '' : ''}" data-flexab="${a.key}"
              style="${chosen.includes(a.key) ? 'background:rgba(201,162,39,.25);color:#3a2c00;border-color:#c9a227' : ''}">
              ${a.short} ${chosen.includes(a.key) ? '✓' : '+' + ca.amount}
            </button>`).join('')}
        </div>
        <small style="color:var(--ink-faint)">Selecionados: ${chosen.length}/${ca.count}</small>
      </div>`;
    }

    const rollBtn = method === 'manual'
      ? `<button class="btn-outline btn-sm" id="ab-roll" style="margin-bottom:12px">🎲 Rolar 4d6 (descarta o menor)</button>` : '';

    return `
      <h2 class="step-title">Distribua os Atributos</h2>
      <p class="step-hint">Método da mesa: <b style="color:var(--gold-bright)">${esc(methodName)}</b></p>
      ${rollBtn}
      ${pool}
      <div class="ability-rows">${rows}</div>
      ${flexible}`;
  }

  // ================= ETAPA: PERÍCIAS =================
  function stepSkills() {
    const r = S.raw;
    const bg = Engine.background(r.backgroundKey);
    const k = Engine.klass(r.classKey);
    const bgSkills = bg?.skills || [];
    const classFrom = k?.skillsFrom || [];
    const classCount = k?.skillCount || 0;

    // perícias extras de raça
    const raceExtraAuto = r.raceKey === 'half_orc' ? ['intimidation'] : [];
    const halfElfPick = r.raceKey === 'half_elf';

    // garante que as automáticas estão marcadas
    const sel = new Set(r.skillProficiencies || []);
    bgSkills.forEach(s => sel.add(s));
    raceExtraAuto.forEach(s => sel.add(s));
    r.skillProficiencies = [...sel];

    const classChosen = [...sel].filter(s => classFrom.includes(s) && !bgSkills.includes(s));
    const remaining = classCount - classChosen.length;

    const renderSkill = (s, state) => {
      const sk = Engine.skill(s);
      const locked = state === 'locked';
      const checked = sel.has(s);
      return `<div class="skill-opt ${checked ? 'checked' : ''} ${locked ? 'locked' : ''}" data-skill="${s}" data-group="${state}">
        <span class="so-check">${checked ? '✓' : ''}</span>
        <span>${esc(sk.name)}</span>
        <span class="so-ab">${Engine.abilities.find(a => a.key === sk.ability).short}</span>
      </div>`;
    };

    let html = `
      <h2 class="step-title">Perícias</h2>
      <p class="step-hint">Treinos que seu herói domina.</p>`;

    if (bgSkills.length) {
      html += `<div class="skill-count">Do antecedente (${esc(bg.name)}) — fixas</div>
        <div class="skill-pick">${bgSkills.map(s => renderSkill(s, 'locked')).join('')}</div>`;
    }
    if (raceExtraAuto.length) {
      html += `<div class="skill-count" style="margin-top:14px">Da raça — fixas</div>
        <div class="skill-pick">${raceExtraAuto.map(s => renderSkill(s, 'locked')).join('')}</div>`;
    }
    if (k) {
      html += `<div class="skill-count" style="margin-top:14px">Da classe (${esc(k.name)}) — escolha ${classCount} · faltam <b>${remaining}</b></div>
        <div class="skill-pick">${classFrom.filter(s => !bgSkills.includes(s)).map(s => renderSkill(s, 'class')).join('')}</div>`;
    }
    if (halfElfPick) {
      const heChosen = [...sel].filter(s => !classFrom.includes(s) && !bgSkills.includes(s));
      const heRemaining = 2 - heChosen.length;
      html += `<div class="skill-count" style="margin-top:14px">Versatilidade Meio-Elfo — escolha 2 · faltam <b>${heRemaining}</b></div>
        <div class="skill-pick">${Engine.skills.filter(s => !classFrom.includes(s.key) && !bgSkills.includes(s.key)).map(s => renderSkill(s.key, 'halfelf')).join('')}</div>`;
    }
    return html;
  }

  // ================= ETAPA: REVISÃO =================
  function stepReview(host) {
    host.innerHTML = `<h2 class="step-title">Revisão Final</h2>
      <p class="step-hint">Confira tudo antes de selar o destino do herói.</p>
      <div id="review-sheet" class="parchment"><p style="text-align:center;color:var(--ink-soft)">Calculando ficha…</p></div>`;
    socket.emit('character:preview', S.raw, (res) => {
      if (!res?.ok) { $('#review-sheet').innerHTML = '<p style="color:var(--wax)">Erro ao calcular a ficha.</p>'; return; }
      if (window.renderSheetContent) {
        $('#review-sheet').innerHTML = window.renderSheetContent(res.character, { review: true });
      }
    });
  }

  // ---------------- Wiring por etapa ----------------
  function wireStep(key) {
    if (key === 'identity') wireIdentity();
    else if (key === 'race') wireRace();
    else if (key === 'class') wireClass();
    else if (key === 'abilities') wireAbilities();
    else if (key === 'skills') wireSkills();
  }

  function wireIdentity() {
    const r = S.raw;
    $('#id-name')?.addEventListener('input', e => { r.name = e.target.value; renderPreview(); });
    $('#id-align')?.addEventListener('change', e => { r.alignment = e.target.value; });
    document.querySelectorAll('#id-portraits .avatar-opt').forEach(el => {
      el.onclick = () => { r.photo = el.dataset.p; renderStep(); renderPreview(); };
    });
    document.querySelectorAll('.color-swatch').forEach(el => {
      el.onclick = () => { r.color = el.dataset.c; renderStep(); renderPreview(); };
    });
    document.querySelectorAll('[data-bg]').forEach(el => {
      el.onclick = () => { r.backgroundKey = el.dataset.bg; renderStep(); };
    });
    $('#id-photo-btn')?.addEventListener('click', () => $('#id-photo-file').click());
    $('#id-photo-file')?.addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) downscaleImage(file, 256, (dataUrl) => { r.photo = dataUrl; renderStep(); renderPreview(); });
    });
  }

  function wireRace() {
    const r = S.raw;
    document.querySelectorAll('[data-race]').forEach(el => {
      el.onclick = () => {
        if (r.raceKey !== el.dataset.race) { r.raceKey = el.dataset.race; r.subraceKey = null; r.chosenAbilityBonuses = {}; }
        renderStep(); renderPreview();
      };
    });
    document.querySelectorAll('[data-sub]').forEach(el => {
      el.onclick = () => { r.subraceKey = el.dataset.sub; renderStep(); renderPreview(); };
    });
  }

  function wireClass() {
    const r = S.raw;
    document.querySelectorAll('[data-class]').forEach(el => {
      el.onclick = () => { r.classKey = el.dataset.class; renderStep(); renderPreview(); };
    });
  }

  function wireAbilities() {
    const r = S.raw;
    // standard array (selects com troca)
    document.querySelectorAll('.ab-select').forEach(sel => {
      sel.onchange = () => {
        const ab = sel.dataset.ab; const val = parseInt(sel.value, 10);
        const other = Object.keys(r.baseAbilities).find(k => k !== ab && r.baseAbilities[k] === val);
        if (other) r.baseAbilities[other] = r.baseAbilities[ab]; // troca
        r.baseAbilities[ab] = val;
        renderStep(); renderPreview();
      };
    });
    // +/- (point buy e manual)
    document.querySelectorAll('.ab-btn').forEach(btn => {
      btn.onclick = () => {
        const ab = btn.dataset.ab; const d = parseInt(btn.dataset.d, 10);
        let v = (r.baseAbilities[ab] ?? 10) + d;
        if (S.method === 'point_buy') {
          v = Math.max(8, Math.min(15, v));
          const test = { ...r.baseAbilities, [ab]: v };
          const spent = Object.values(test).reduce((a, s) => a + Engine.pointBuyCost(s), 0);
          if (spent > 27) return toast('Pontos insuficientes.', true);
        } else {
          v = Math.max(3, Math.min(20, v));
        }
        r.baseAbilities[ab] = v;
        renderStep(); renderPreview();
      };
    });
    // rolar 4d6
    $('#ab-roll')?.addEventListener('click', () => {
      for (const a of Engine.abilities) r.baseAbilities[a.key] = roll4d6();
      toast('Atributos rolados!'); renderStep(); renderPreview();
    });
    // bônus flexível
    document.querySelectorAll('[data-flexab]').forEach(btn => {
      btn.onclick = () => {
        const ab = btn.dataset.flexab;
        const race = Engine.race(r.raceKey); const ca = race.chooseAbilities;
        const chosen = { ...(r.chosenAbilityBonuses || {}) };
        if (chosen[ab]) delete chosen[ab];
        else {
          if (Object.keys(chosen).length >= ca.count) return toast(`Escolha apenas ${ca.count}.`, true);
          chosen[ab] = ca.amount;
        }
        r.chosenAbilityBonuses = chosen;
        renderStep(); renderPreview();
      };
    });
  }

  function wireSkills() {
    const r = S.raw;
    const k = Engine.klass(r.classKey);
    document.querySelectorAll('.skill-opt').forEach(el => {
      if (el.classList.contains('locked')) return;
      el.onclick = () => {
        const s = el.dataset.skill; const group = el.dataset.group;
        const sel = new Set(r.skillProficiencies);
        if (sel.has(s)) { sel.delete(s); }
        else {
          if (group === 'class') {
            const classFrom = k.skillsFrom; const bg = Engine.background(r.backgroundKey)?.skills || [];
            const count = [...sel].filter(x => classFrom.includes(x) && !bg.includes(x)).length;
            if (count >= k.skillCount) return toast(`Escolha apenas ${k.skillCount} da classe.`, true);
          } else if (group === 'halfelf') {
            const classFrom = k?.skillsFrom || []; const bg = Engine.background(r.backgroundKey)?.skills || [];
            const he = [...sel].filter(x => !classFrom.includes(x) && !bg.includes(x));
            if (he.length >= 2) return toast('Escolha apenas 2 (Meio-Elfo).', true);
          }
          sel.add(s);
        }
        r.skillProficiencies = [...sel];
        renderStep(); renderPreview();
      };
    });
  }

  // ---------------- Prévia ao vivo ----------------
  function renderPreview() {
    const r = S.raw;
    const lite = Engine.computeLite(r);
    const race = Engine.race(r.raceKey);
    const sub = Engine.subrace(r.raceKey, r.subraceKey);
    const k = Engine.klass(r.classKey);
    const safeP = Engine.safePhoto(r.photo);
    const portrait = (safeP && safeP.startsWith('data:'))
      ? `<div class="pv-portrait" style="background-image:url('${safeP}')"></div>`
      : `<div class="pv-portrait" style="color:${esc(r.color)}">${esc((safeP && !safeP.startsWith('data:')) ? safeP : '🧙')}</div>`;
    const raceLabel = race ? (sub ? `${sub.name}` : race.name) : '—';
    $('#builder-preview').innerHTML = `
      ${portrait}
      <div class="pv-name" style="color:${esc(r.color)}">${esc(r.name || 'Sem nome')}</div>
      <div class="pv-sub">${esc(raceLabel)} ${k ? esc(k.name) : ''} · Nível ${lite.level}</div>
      <div class="pv-stats">
        <div class="pv-stat"><div class="pv-val">${lite.maxHp || '—'}</div><div class="pv-lbl">PV</div></div>
        <div class="pv-stat"><div class="pv-val">${lite.ac}</div><div class="pv-lbl">CA</div></div>
        <div class="pv-stat"><div class="pv-val">${Engine.signed(lite.initiative)}</div><div class="pv-lbl">Inic.</div></div>
      </div>
      <div class="pv-abilities">
        ${Engine.abilities.map(a => `<div class="pv-ab">
          <div class="pv-ab-name">${a.short}</div>
          <div class="pv-ab-score">${lite.finals[a.key]}</div>
          <div class="pv-ab-mod">${Engine.signed(lite.mods[a.key])}</div>
        </div>`).join('')}
      </div>`;
  }

  // ---------------- Navegação ----------------
  function next() {
    const err = validateStep();
    if (err) return toast(err, true);
    if (S.step === STEPS.length - 1) { finish(); return; }
    S.step++; render(); window.scrollTo(0, 0);
  }
  function prev() { if (S.step > 0) { S.step--; render(); window.scrollTo(0, 0); } }

  function validateStep() {
    const r = S.raw; const key = STEPS[S.step].key;
    if (key === 'identity') {
      if (!r.name.trim()) return 'Dê um nome ao personagem.';
      if (!r.backgroundKey) return 'Escolha um antecedente.';
    }
    if (key === 'race') {
      if (!r.raceKey) return 'Escolha uma raça.';
      const race = Engine.race(r.raceKey);
      if (race?.subraces && !r.subraceKey) return 'Escolha uma linhagem.';
    }
    if (key === 'class') { if (!r.classKey) return 'Escolha uma classe.'; }
    if (key === 'abilities') {
      const race = Engine.race(r.raceKey);
      if (race?.chooseAbilities) {
        const n = Object.keys(r.chosenAbilityBonuses || {}).length;
        if (n !== race.chooseAbilities.count) return `Escolha ${race.chooseAbilities.count} atributos para o bônus racial.`;
      }
      if (S.method === 'point_buy') {
        const spent = Object.values(r.baseAbilities).reduce((a, s) => a + Engine.pointBuyCost(s), 0);
        if (spent > 27) return 'Você gastou pontos demais.';
      }
    }
    if (key === 'skills') {
      const k = Engine.klass(r.classKey);
      const bg = Engine.background(r.backgroundKey)?.skills || [];
      const classChosen = (r.skillProficiencies || []).filter(s => k.skillsFrom.includes(s) && !bg.includes(s)).length;
      if (classChosen < k.skillCount) return `Escolha ${k.skillCount} perícias da classe.`;
      if (r.raceKey === 'half_elf') {
        const he = (r.skillProficiencies || []).filter(s => !k.skillsFrom.includes(s) && !bg.includes(s)).length;
        if (he < 2) return 'Escolha as 2 perícias do Meio-Elfo.';
      }
    }
    return null;
  }

  function finish() {
    const btn = $('#builder-next'); btn.disabled = true;
    socket.emit('character:save', { raw: S.raw, targetCharId: S.editing ? S.targetCharId : undefined }, (res) => {
      btn.disabled = false;
      if (!res?.ok) return toast(res?.error || 'Erro ao salvar.', true);
      toast(S.editing ? 'Ficha atualizada!' : 'Personagem criado!');
      S.onComplete?.(res);
    });
  }

  // ---------------- Utilidades ----------------
  function roll4d6() {
    const r = [0, 0, 0, 0].map(() => Math.floor(Math.random() * 6) + 1).sort((a, b) => b - a);
    return r[0] + r[1] + r[2];
  }
  function downscaleImage(file, max, cb) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        try { cb(canvas.toDataURL('image/jpeg', 0.82)); } catch (_) { toast('Não consegui processar a imagem.', true); }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }
  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

  // expõe navegação para o app
  return { init, open, next, prev, _state: () => S };
})();

window.Builder = Builder;
