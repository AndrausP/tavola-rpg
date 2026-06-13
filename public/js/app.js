// public/js/app.js — núcleo do cliente com login, painel e mesa.
(() => {
  'use strict';

  let socket = null;
  const App = {
    user: null, room: null, you: null, role: null, myCharId: null,
    diceMode: 'normal', tab: 'party', sheetId: null,
  };

  // ---------- Helpers ----------
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const esc = (s) => (s ?? '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  window.esc = esc;
  let toastTimer;
  function toast(msg, isErr = false) {
    const t = $('#toast'); t.textContent = msg; t.classList.toggle('error', isErr); t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }
  window.toast = toast;
  function showScreen(id) { $$('.screen').forEach(s => s.classList.remove('active')); $('#' + id).classList.add('active'); window.scrollTo(0, 0); }
  window.showScreen = showScreen;
  function diceAnim() { const d = $('#dice-anim'); d.hidden = false; setTimeout(() => { d.hidden = true; }, 600); }

  async function api(path, { method = 'GET', body, auth = false } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) { const t = Session.getToken(); if (t) headers.Authorization = 'Bearer ' + t; }
    let res, data = {};
    try {
      res = await fetch('/api/auth/' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
      try { data = await res.json(); } catch (_) {}
      return { status: res.status, ...data };
    } catch (_) { return { status: 0, error: 'Falha de conexão.' }; }
  }

  // =========================================================
  // BOOT
  // =========================================================
  async function boot() {
    handleConfirmRedirect();
    await Engine.load();
    wireAuth();
    wireHome();
    wireCreate();
    wireTable();
    wireBuilderNav();
    fetch('/api/meta').then(r => r.json()).then(m => {
      if (m.stats) $('#server-stats').textContent = `${m.stats.rooms} mesas abertas · ${m.stats.players} aventureiros`;
    }).catch(() => {});

    const token = Session.getToken();
    if (token) {
      const me = await api('me', { auth: true });
      if (me.ok) return onAuthenticated(token, me.user);
      Session.clear();
    }
    showScreen('screen-auth');
  }

  function handleConfirmRedirect() {
    const p = new URLSearchParams(location.search);
    if (p.has('confirmado')) {
      const okc = p.get('confirmado') === '1';
      setTimeout(() => toast(okc ? '✅ E-mail confirmado! Agora é só entrar.' : '❌ Link inválido ou expirado.', !okc), 300);
      p.delete('confirmado');
      history.replaceState({}, '', location.pathname + (p.toString() ? '?' + p : ''));
    }
  }

  // =========================================================
  // AUTENTICAÇÃO (telas)
  // =========================================================
  function wireAuth() {
    $$('.auth-tab').forEach(t => t.onclick = () => {
      $$('.auth-tab').forEach(x => x.classList.toggle('active', x === t));
      const tab = t.dataset.atab;
      $('#pane-login').hidden = tab !== 'login';
      $('#pane-register').hidden = tab !== 'register';
      $('#login-msg').textContent = ''; $('#reg-msg').textContent = '';
    });

    $('#btn-login').onclick = doLogin;
    $('#login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    $('#btn-register').onclick = doRegister;
    $('#reg-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doRegister(); });

    $('#btn-resend').onclick = async () => {
      const email = App._pendingEmail;
      if (!email) return;
      const r = await api('resend', { method: 'POST', body: { email } });
      if (r.devConfirmUrl) showDevConfirm(r.devConfirmUrl);
      toast('Se a conta existir e estiver pendente, o e-mail foi reenviado.');
    };
    $('#btn-confirm-back').onclick = () => { $('#confirm-card').hidden = true; $('#auth-forms').hidden = false; };
  }

  async function doLogin() {
    const email = $('#login-email').value.trim();
    const password = $('#login-pass').value;
    const msg = $('#login-msg'); msg.textContent = '';
    if (!email || !password) { msg.textContent = 'Preencha e-mail e senha.'; return; }
    setBtnLoading('#btn-login', true);
    const r = await api('login', { method: 'POST', body: { email, password } });
    setBtnLoading('#btn-login', false);
    if (r.ok) { onAuthenticated(r.token, r.user); return; }
    if (r.needsConfirm) { showConfirmPending(r.email || email); return; }
    msg.textContent = r.error || 'Não foi possível entrar.';
  }

  async function doRegister() {
    const name = $('#reg-name').value.trim();
    const email = $('#reg-email').value.trim();
    const birthdate = $('#reg-birth').value;
    const password = $('#reg-pass').value;
    const msg = $('#reg-msg'); msg.textContent = '';
    if (!name || !email || !birthdate || !password) { msg.textContent = 'Preencha todos os campos.'; return; }
    if (password.length < 8) { msg.textContent = 'A senha precisa de ao menos 8 caracteres.'; return; }
    setBtnLoading('#btn-register', true);
    const r = await api('register', { method: 'POST', body: { name, email, birthdate, password } });
    setBtnLoading('#btn-register', false);
    if (r.ok) { showConfirmPending(email); if (r.devConfirmUrl) showDevConfirm(r.devConfirmUrl); return; }
    msg.textContent = r.error || 'Não foi possível criar a conta.';
  }

  function showConfirmPending(email) {
    App._pendingEmail = email;
    $('#confirm-email').textContent = email;
    $('#auth-forms').hidden = true;
    $('#confirm-card').hidden = false;
    $('#dev-confirm').hidden = true;
  }
  function showDevConfirm(url) {
    const link = $('#dev-confirm-link');
    link.href = url; $('#dev-confirm').hidden = false;
  }
  function setBtnLoading(sel, on) { const b = $(sel); if (b) { b.disabled = on; b.style.opacity = on ? '.6' : ''; } }

  function onAuthenticated(token, user) {
    App.user = user; Session.setToken(token); Session.setUser(user);
    connectSocket(token, () => { loadDashboard(); showScreen('screen-home'); });
  }

  // =========================================================
  // SOCKET (autenticado)
  // =========================================================
  function connectSocket(token, onReady) {
    if (socket) { try { socket.disconnect(); } catch (_) {} socket = null; }
    socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
    Builder.init(socket);
    wireSocket();
    socket.once('connect', () => onReady && onReady());
  }

  function wireSocket() {
    socket.on('room:state', (state) => { if (App.room) applyRoomState(state); });
    socket.on('log:history', (log) => renderLogHistory(log));
    socket.on('log:entry', (entry) => appendLog(entry));
    socket.on('system:message', (text) => appendLog({ type: 'system', text }));
    socket.on('session:paused', () => { if (App.role !== 'dm') { toast('O mestre pausou a sessão.'); App.room = null; showScreen('screen-home'); loadDashboard(); } });
    socket.on('security:notice', (m) => toast(m, true));
    socket.on('disconnect', () => toast('Conexão perdida. Reconectando…', true));
  }

  // =========================================================
  // PAINEL INICIAL
  // =========================================================
  const AVATARS = ['🧙','🧝','🧔','🦹','🧚','🤴','👸','🧛','🧟','🐉','🦅','🐺','😈','👹','🥷','🧞','⚔️','🏹','🛡️','🔮'];

  function wireHome() {
    const grid = $('#home-avatar-grid');
    grid.innerHTML = AVATARS.map(a => `<div class="avatar-opt" data-a="${a}">${a}</div>`).join('');
    grid.querySelectorAll('.avatar-opt').forEach(el => el.onclick = () => {
      socket?.emit('profile:update', { avatar: el.dataset.a }, (res) => {
        if (res?.ok) { App.user = res.user; Session.setUser(res.user); renderAccount(res.user); toast('Avatar atualizado.'); }
      });
    });
    $('#btn-save-name').onclick = () => {
      const name = $('#home-name').value.trim();
      if (!name) return toast('Digite um nome.', true);
      socket?.emit('profile:update', { name }, (res) => {
        if (res?.ok) { App.user = res.user; Session.setUser(res.user); toast('Nome salvo.'); }
      });
    };
    $('#btn-logout').onclick = doLogout;

    $('#btn-goto-create').onclick = () => showScreen('screen-create');
    $('#btn-goto-join').onclick = () => { const b = $('#join-box'); b.hidden = !b.hidden; if (!b.hidden) $('#join-code').focus(); };
    $('#btn-join').onclick = doJoin;
    $('#join-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    $('#join-code').addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
    $$('[data-back]').forEach(b => b.onclick = () => showScreen(b.dataset.back));
  }

  async function doLogout() {
    try { await api('logout', { method: 'POST', auth: true }); } catch (_) {}
    Session.clear(); App.user = null; App.room = null;
    if (socket) { try { socket.disconnect(); } catch (_) {} socket = null; }
    showScreen('screen-auth');
    toast('Você saiu da conta.');
  }

  function loadDashboard() {
    socket.emit('dashboard:load', (res) => {
      if (!res?.ok) { if (res?.error) toast(res.error, true); return; }
      App.user = res.user; Session.setUser(res.user);
      renderAccount(res.user);
      renderDashboard(res);
    });
  }

  function renderAccount(user) {
    $('#home-avatar').textContent = user.avatar || '🧙';
    if (document.activeElement !== $('#home-name')) $('#home-name').value = user.name || '';
    $('#home-email').textContent = user.email + (user.isAdult ? ' · 🔞 18+' : (user.age != null ? ` · ${user.age} anos` : ''));
    $$('#home-avatar-grid .avatar-opt').forEach(el => el.classList.toggle('selected', el.dataset.a === user.avatar));
  }

  function renderDashboard(data) {
    const s = data.user?.stats || {};
    $('#home-stats').innerHTML = `
      <span><b>${s.sessionsMastered || 0}</b> mestradas</span>
      <span><b>${s.sessionsPlayed || 0}</b> jogadas</span>
      <span><b>${s.charactersCreated || 0}</b> personagens</span>`;

    const paused = data.pausedSessions || [];
    $('#paused-box').hidden = paused.length === 0;
    if (paused.length) {
      $('#paused-list').innerHTML = paused.map(ps => `
        <div class="session-item">
          <span class="si-role ${ps.isDM ? 'dm' : 'player'}">${ps.isDM ? 'Mestre' : 'Jogador'}</span>
          <div class="si-main"><div class="si-name">${esc(ps.name)}</div>
            <div class="si-meta">${ps.playerCount} personagem(ns) · ${timeAgo(ps.savedAt)}</div></div>
          ${ps.isDM ? `<button class="btn-wax btn-sm" data-resume="${ps.code}">Retomar</button>`
                    : `<button class="btn-outline btn-sm" data-rejoin="${ps.code}">Entrar</button>`}
        </div>`).join('');
      $$('[data-resume]').forEach(b => b.onclick = () => resumeSession(b.dataset.resume));
      $$('[data-rejoin]').forEach(b => b.onclick = () => { $('#join-code').value = b.dataset.rejoin; doJoin(); });
    }

    const hist = data.history || [];
    $('#history-box').hidden = hist.length === 0;
    if (hist.length) {
      $('#history-list').innerHTML = hist.slice(0, 12).map(h => `
        <div class="history-item">
          <span class="si-role ${h.role === 'dm' ? 'dm' : 'player'}">${h.role === 'dm' ? 'Mestre' : 'Jogador'}</span>
          <div class="si-main"><div class="si-name" style="font-size:.95rem">${esc(h.name || 'Mesa')}</div>
            <div class="si-meta">${timeAgo(h.at)}</div></div>
        </div>`).join('');
    }

    // auto-join via ?mesa=
    const code = new URLSearchParams(location.search).get('mesa');
    if (code) { $('#join-code').value = code.toUpperCase(); $('#join-box').hidden = false; }
  }

  // =========================================================
  // CRIAR / ENTRAR
  // =========================================================
  function wireCreate() {
    $('#btn-create-room').onclick = () => {
      const config = {
        name: $('#camp-name').value.trim() || 'Nova Campanha',
        levelStart: parseInt($('#camp-level').value, 10) || 1,
        maxPlayers: parseInt($('#camp-max').value, 10) || 5,
        abilityMethod: document.querySelector('input[name="method"]:checked')?.value || 'standard_array',
        allowPlayerRolls: $('#camp-rolls').checked,
        dmCanEdit: $('#camp-dmedit').checked,
        adult: $('#camp-adult').checked,
      };
      socket.emit('room:create', { config }, (res) => {
        if (!res?.ok) return toast(res?.error || 'Erro ao criar mesa.', true);
        enterRoom(res); toast('Mesa criada! Compartilhe o código ⚜');
      });
    };
  }

  function doJoin() {
    const code = $('#join-code').value.trim().toUpperCase();
    if (code.length < 4) return toast('Digite o código da mesa.', true);
    socket.emit('room:join', { code }, (res) => {
      if (!res?.ok) return toast(res?.error || 'Erro ao entrar.', true);
      enterRoom(res);
      if (!res.characterId) setTimeout(() => openBuilder(false), 400);
    });
  }
  function resumeSession(code) {
    socket.emit('room:resume', { code }, (res) => {
      if (!res?.ok) return toast(res?.error || 'Erro ao retomar.', true);
      enterRoom(res);
    });
  }

  // =========================================================
  // MESA
  // =========================================================
  function enterRoom(res) {
    App.you = res.you; App.role = res.role; App.room = res.state;
    App.myCharId = res.characterId || findMyChar(res.state);
    applyRoomState(res.state);
    showScreen('screen-table');
    document.body.classList.toggle('is-dm', res.role === 'dm');
    $('#tb-code-val').textContent = res.code;
  }
  function findMyChar(state) { return state.members.find(m => m.socketId === App.you)?.characterId || null; }

  function applyRoomState(state) {
    App.room = state;
    const me = state.members.find(m => m.socketId === App.you);
    if (me) { App.role = me.role; App.myCharId = me.characterId; }
    document.body.classList.toggle('is-dm', App.role === 'dm');
    $('#tb-name').textContent = state.name;
    $('#tb-adult').hidden = !state.config.adult;
    $('#scene-text').textContent = state.scene || 'A aventura está prestes a começar…';
    renderParty(state);
    updateNewCharBtn();
    if (App.sheetId) { const c = state.characters.find(c => c.id === App.sheetId); if (c) openSheet(c.id); else closeSheet(); }
  }

  function updateNewCharBtn() {
    const btn = $('#btn-new-char');
    if (App.role === 'dm') btn.textContent = '+ NPC';
    else if (App.myCharId) btn.textContent = '✎ Meu personagem';
    else btn.textContent = '+ Criar personagem';
  }

  function renderParty(state) {
    const list = $('#party-list');
    if (!state.characters.length) {
      list.innerHTML = `<p style="color:var(--parch-edge);text-align:center;padding:20px;font-style:italic">Nenhum personagem ainda.<br>${App.role === 'dm' ? 'Aguarde os jogadores criarem seus heróis.' : 'Crie o seu herói!'}</p>`;
      return;
    }
    list.innerHTML = state.characters.map(c => {
      const hpPct = c.maxHp ? Math.max(0, Math.min(100, (c.currentHp / c.maxHp) * 100)) : 0;
      const safe = Engine.safePhoto(c.photo);
      const portrait = (safe && safe.startsWith('data:'))
        ? `<div class="cc-portrait" style="background-image:url('${safe}')"></div>`
        : `<div class="cc-portrait" style="color:${esc(c.color)}">${esc((safe && !safe.startsWith('data:')) ? safe : (c.raceEmoji || '🧙'))}</div>`;
      return `<div class="char-card" data-char="${c.id}" style="border-left-color:${esc(c.color)}">
        ${portrait}
        <div class="cc-main">
          <div class="cc-name" style="color:${esc(c.color)}">${esc(c.name)} ${c.isNPC ? '<span class="cc-npc">NPC</span>' : ''}</div>
          <div class="cc-sub">${esc(c.raceName)}${c.subraceName ? ` (${esc(c.subraceName)})` : ''} · ${esc(c.className)} Nv.${c.level}</div>
          <div class="cc-stats">
            <span class="cc-chip">❤️ ${c.currentHp}/${c.maxHp}</span>
            <span class="cc-chip">🛡️ ${c.ac}</span>
            <span class="cc-chip">⚡ ${Engine.signed(c.initiative)}</span>
          </div>
          <div class="hp-bar"><div class="hp-fill" style="width:${hpPct}%"></div></div>
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('[data-char]').forEach(el => el.onclick = () => openSheet(el.dataset.char));
  }

  // ---------- Ficha (compartilhada com o builder) ----------
  function renderSheetContent(c, opts = {}) {
    const ab = Engine.abilities;
    const vitals = [
      ['❤️', c.maxHp, 'PV máx'], ['🛡️', c.ac, 'CA'],
      ['⚡', Engine.signed(c.initiative), 'Iniciativa'], ['👣', c.speed + 'm', 'Desloc.'],
      ['👁️', c.passivePerception, 'Perc. Passiva'], ['✦', Engine.signed(c.profBonus), 'Proficiência'],
    ];
    const safeP = Engine.safePhoto(c.photo);
    const portrait = (safeP && safeP.startsWith('data:'))
      ? `<div class="sheet-portrait" style="background-image:url('${safeP}')"></div>`
      : `<div class="sheet-portrait" style="color:${esc(c.color)}">${esc((safeP && !safeP.startsWith('data:')) ? safeP : (c.raceEmoji || '🧙'))}</div>`;
    const abilitiesHtml = ab.map(a => `
      <div class="ability-box" ${opts.review ? '' : `data-roll-ability="${a.key}" data-mod="${c.mods[a.key]}" data-label="Teste de ${a.name}"`}>
        <div class="ab-label">${a.short}</div><div class="ab-num">${c.abilities[a.key]}</div><div class="ab-mod-val">${Engine.signed(c.mods[a.key])}</div>
      </div>`).join('');
    const savesHtml = ab.map(a => `
      <div class="skill-line" ${opts.review ? '' : `data-roll-save="${a.key}" data-mod="${c.saves[a.key].mod}" data-label="Resistência de ${a.name}"`}>
        <span class="sl-dot ${c.saves[a.key].proficient ? 'prof' : ''}"></span><span class="sl-name">${a.name}</span><span class="sl-mod">${Engine.signed(c.saves[a.key].mod)}</span>
      </div>`).join('');
    const skillsHtml = Engine.skills.map(s => {
      const sk = c.skills[s.key];
      return `<div class="skill-line" ${opts.review ? '' : `data-roll-skill="${s.key}" data-mod="${sk.mod}" data-label="${s.name}"`}>
        <span class="sl-dot ${sk.proficient ? 'prof' : ''}"></span><span class="sl-name">${s.name}</span>
        <span class="sl-ab">${ab.find(a => a.key === s.ability).short}</span><span class="sl-mod">${Engine.signed(sk.mod)}</span></div>`;
    }).join('');
    const spellHtml = c.spellcasting ? `
      <div class="sheet-section-title">Conjuração</div>
      <div class="sheet-vitals" style="grid-template-columns:repeat(3,1fr)">
        <div class="vital"><div class="v-val">${ab.find(a => a.key === c.spellcasting).short}</div><div class="v-lbl">Atributo</div></div>
        <div class="vital"><div class="v-val">${c.spellSaveDC}</div><div class="v-lbl">CD de Magia</div></div>
        <div class="vital"><div class="v-val">${Engine.signed(c.spellAttack)}</div><div class="v-lbl">Ataque Mágico</div></div>
      </div>` : '';
    const canEdit = !opts.review && (App.role === 'dm' || c.id === App.myCharId);
    const hpEditor = canEdit ? `
      <div class="sheet-section-title">Pontos de Vida</div>
      <div class="hp-editor">
        <button class="ab-btn" data-hp="-5">−5</button><button class="ab-btn" data-hp="-1">−1</button>
        <input class="ink-input" id="hp-current" type="number" value="${c.currentHp}" /><span style="color:var(--ink-soft)">/ ${c.maxHp}</span>
        <button class="ab-btn" data-hp="1">+1</button><button class="ab-btn" data-hp="5">+5</button>
      </div>` : '';
    const actions = opts.review ? '' : `
      <div class="sheet-actions">
        <button class="btn-wax btn-sm" data-roll-init>⚡ Rolar Iniciativa</button>
        ${canEdit ? `<button class="btn-outline btn-sm" id="sheet-edit">✎ Editar ficha</button>` : ''}
        ${canEdit ? `<button class="btn-outline btn-sm" id="sheet-delete" style="border-color:var(--wax);color:var(--wax-bright)">🗑 Apagar</button>` : ''}
      </div>`;
    return `
      <div class="sheet-head">${portrait}
        <div class="sheet-id">
          <div class="sheet-name" style="color:${esc(c.color)}">${esc(c.name)} ${c.isNPC ? '<span class="cc-npc">NPC</span>' : ''}</div>
          <div class="sheet-sub">${esc(c.raceName)}${c.subraceName ? ` (${esc(c.subraceName)})` : ''} · ${esc(c.className)} · Nível ${c.level} · ${esc(c.alignment)}</div>
        </div>
        ${opts.review ? '' : `<button class="sheet-close" id="sheet-close">✕</button>`}
      </div>
      <div class="sheet-vitals">${vitals.map(v => `<div class="vital"><div class="v-val">${v[1]}</div><div class="v-lbl">${v[0]} ${v[2]}</div></div>`).join('')}</div>
      ${hpEditor}
      <div class="sheet-section-title">Atributos ${opts.review ? '' : '<small style="font-weight:400;font-family:var(--serif);color:var(--ink-faint)">(toque p/ rolar)</small>'}</div>
      <div class="abilities-grid">${abilitiesHtml}</div>
      <div class="sheet-section-title">Testes de Resistência</div><div class="saves-grid">${savesHtml}</div>
      <div class="sheet-section-title">Perícias</div><div class="skills-grid">${skillsHtml}</div>
      ${spellHtml}
      <div class="sheet-section-title">Traços & Habilidades</div>
      <div class="sheet-features">${c.features.map(f => `<span class="feat-chip">${esc(f)}</span>`).join('') || '<span style="color:var(--ink-faint)">—</span>'}</div>
      ${c.bio ? `<div class="sheet-section-title">História</div><div class="sheet-bio">${esc(c.bio)}</div>` : ''}
      ${actions}`;
  }
  window.renderSheetContent = renderSheetContent;

  function openSheet(cid) {
    const c = App.room.characters.find(x => x.id === cid);
    if (!c) return;
    App.sheetId = cid;
    $('#sheet-modal').innerHTML = renderSheetContent(c, {});
    $('#sheet-overlay').hidden = false;
    wireSheet(c);
  }
  function closeSheet() { App.sheetId = null; $('#sheet-overlay').hidden = true; }

  function wireSheet(c) {
    $('#sheet-close')?.addEventListener('click', closeSheet);
    const doRoll = (mod, label) => socket.emit('roll:check', { modifier: parseInt(mod, 10) || 0, mode: App.diceMode, label }, (res) => {
      if (!res?.ok) toast(res?.error || 'Não foi possível rolar.', true); else diceAnim();
    });
    $('#sheet-modal').querySelectorAll('[data-roll-skill],[data-roll-save],[data-roll-ability]').forEach(el => el.onclick = () => doRoll(el.dataset.mod, el.dataset.label));
    $('#sheet-modal').querySelector('[data-roll-init]')?.addEventListener('click', () => doRoll(c.initiative, 'Iniciativa'));
    const sendHp = (val) => socket.emit('character:save', { raw: { currentHp: val }, targetCharId: c.id }, (res) => { if (!res?.ok) toast(res?.error || 'Erro.', true); });
    $('#sheet-modal').querySelectorAll('[data-hp]').forEach(btn => btn.onclick = () => sendHp((parseInt($('#hp-current').value, 10) || 0) + parseInt(btn.dataset.hp, 10)));
    $('#hp-current')?.addEventListener('change', e => sendHp(parseInt(e.target.value, 10) || 0));
    $('#sheet-edit')?.addEventListener('click', () => {
      socket.emit('character:raw', { characterId: c.id }, (res) => {
        if (!res?.ok) return toast(res?.error || 'Não consegui carregar a ficha.', true);
        closeSheet();
        Builder.open({ config: App.room.config, existingRaw: res.raw, onComplete: () => showScreen('screen-table') });
      });
    });
    $('#sheet-delete')?.addEventListener('click', () => {
      if (!confirm(`Apagar ${c.name}? Isso não pode ser desfeito.`)) return;
      socket.emit('character:delete', { characterId: c.id }, (res) => { if (res?.ok) { closeSheet(); toast('Personagem apagado.'); } });
    });
  }

  // ---------- Builder ----------
  function openBuilder(npc) {
    if (App.role !== 'dm' && App.myCharId && !npc) {
      socket.emit('character:raw', { characterId: App.myCharId }, (res) => {
        Builder.open({ config: App.room.config, existingRaw: res?.ok ? res.raw : null, onComplete: () => showScreen('screen-table') });
      });
      return;
    }
    const seed = npc ? { ...defaultRaw(App.room.config), isNPC: true, _isSeed: true } : null;
    Builder.open({ config: App.room.config, existingRaw: seed, onComplete: () => showScreen('screen-table') });
  }
  function defaultRaw(config) {
    return { name: '', isNPC: true, level: config.levelStart || 1, color: '#7a6a3a',
      baseAbilities: config.abilityMethod === 'point_buy' ? { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 } : { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
      chosenAbilityBonuses: {}, skillProficiencies: [] };
  }
  function wireBuilderNav() { $('#builder-next').onclick = () => Builder.next(); $('#builder-prev').onclick = () => Builder.prev(); }

  // ---------- Barra / cena / dados / chat / tabs ----------
  function wireTable() {
    $('#btn-new-char').onclick = () => openBuilder(App.role === 'dm');
    $('#tb-code').onclick = () => navigator.clipboard?.writeText(App.room.code).then(() => toast('Código copiado!'), () => toast(App.room.code));
    $('#tb-share').onclick = () => {
      const url = `${location.origin}/?mesa=${App.room.code}`;
      if (navigator.share) navigator.share({ title: 'Távola RPG', text: `Entre na mesa "${App.room.name}"!`, url });
      else navigator.clipboard?.writeText(url).then(() => toast('Convite copiado!'));
    };
    $('#tb-leave').onclick = () => { socket.emit('room:leave'); App.room = null; showScreen('screen-home'); loadDashboard(); };
    $('#tb-pause').onclick = () => socket.emit('session:pause', (res) => { if (res?.ok) { toast('Sessão pausada e salva.'); App.room = null; showScreen('screen-home'); loadDashboard(); } });
    $('#scene-collapse').onclick = () => $('#scene-banner').classList.toggle('collapsed');
    $('#scene-edit').onclick = editScene;
    $$('.ttab').forEach(t => t.onclick = () => setTab(t.dataset.tab));
    setTab('party');
    $('#quick-dice').innerHTML = (Engine.srd.quickDice || [4, 6, 8, 10, 12, 20, 100]).map(d => `<button class="die-btn" data-die="${d}">d${d}<span>1 dado</span></button>`).join('');
    $$('#quick-dice .die-btn').forEach(b => b.onclick = () => rollExpr(`1d${b.dataset.die}`, `d${b.dataset.die}`));
    $$('.mode-btn').forEach(b => b.onclick = () => { App.diceMode = b.dataset.mode; $$('.mode-btn').forEach(x => x.classList.toggle('active', x === b)); });
    $('#btn-roll-expr').onclick = () => { const e = $('#dice-expr').value.trim(); if (e) { rollExpr(e, ''); $('#dice-expr').value = ''; } };
    $('#dice-expr').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-roll-expr').click(); });
    const sendChat = () => { const t = $('#chat-input').value.trim(); if (t) { socket.emit('chat:send', t); $('#chat-input').value = ''; } };
    $('#btn-chat').onclick = sendChat;
    $('#chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
    $('#sheet-overlay').addEventListener('click', e => { if (e.target.id === 'sheet-overlay') closeSheet(); });
  }

  function setTab(tab) {
    App.tab = tab; $$('.ttab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    const map = { party: 'col-party', log: 'col-log', dice: 'col-dice' };
    Object.entries(map).forEach(([k, id]) => $('#' + id).classList.toggle('tab-active', k === tab));
  }
  function editScene() {
    const cur = App.room.scene || ''; const el = $('#scene-text');
    el.innerHTML = `<textarea id="scene-ta" class="ink-input" style="width:100%;min-height:80px">${esc(cur)}</textarea>
      <div style="display:flex;gap:8px;margin-top:8px"><button class="btn-wax btn-sm" id="scene-save">Salvar cena</button><button class="btn-outline btn-sm" id="scene-cancel">Cancelar</button></div>`;
    $('#scene-save').onclick = () => socket.emit('scene:set', $('#scene-ta').value, (res) => { if (!res?.ok) toast('Erro.', true); });
    $('#scene-cancel').onclick = () => applyRoomState(App.room);
  }
  function rollExpr(expr, label) {
    socket.emit('roll:freeform', { expression: expr, label }, (res) => {
      if (!res?.ok) return toast(res?.error || 'Expressão inválida.', true);
      diceAnim();
      const e = res.entry;
      $('#last-roll').innerHTML = `<div style="text-align:center"><span style="font-family:var(--display);font-weight:900;font-size:2rem;color:var(--blood)">${e.result.total}</span><br><small style="color:var(--ink-faint)">${esc(e.result.text)}</small></div>`;
    });
  }

  // ---------- Log ----------
  function appendLog(entry) { const feed = $('#log-feed'); const div = document.createElement('div'); div.innerHTML = formatLog(entry); if (div.firstElementChild) feed.appendChild(div.firstElementChild); feed.scrollTop = feed.scrollHeight; }
  function renderLogHistory(log) { $('#log-feed').innerHTML = log.map(formatLog).join(''); const f = $('#log-feed'); f.scrollTop = f.scrollHeight; }
  function formatLog(e) {
    if (e.type === 'system') return `<div class="log-entry system">❧ ${esc(e.text)}</div>`;
    if (e.type === 'chat') return `<div class="log-entry log-chat"><span class="lc-author" style="color:${esc(e.color)}">${esc(e.avatar)} ${esc(e.author)}:</span> <span class="lc-text">${esc(e.text)}</span></div>`;
    if (e.type === 'roll') {
      const r = e.result; let total, detail, critClass = '', tag = '';
      if (e.kind === 'check') {
        total = r.total; const modStr = r.modifier ? Engine.signed(r.modifier) : '';
        detail = `d20${r.mode !== 'normal' ? ` [${r.dice.join(' / ')}]` : ` [${r.chosen}]`} ${modStr}`;
        if (r.isCrit) { critClass = 'crit'; tag = '<span class="lr-tag crit">CRÍTICO!</span>'; }
        if (r.isFumble) { critClass = 'fumble'; tag = '<span class="lr-tag fumble">FALHA CRÍTICA</span>'; }
      } else { total = r.total; detail = r.text; }
      return `<div class="log-entry log-roll"><div class="lr-head">
          <span class="lr-author" style="color:${esc(e.color)}">${esc(e.avatar)} ${esc(e.author)}</span>
          <span class="lr-label">${esc(e.label || '')}</span></div>
        <div class="lr-body"><span class="lr-total ${critClass}">${total}</span><span class="lr-detail">${esc(detail)}</span>${tag}</div></div>`;
    }
    return '';
  }

  function timeAgo(ts) {
    if (!ts) return '';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'agora há pouco';
    if (s < 3600) return `há ${Math.floor(s / 60)} min`;
    if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
    return `há ${Math.floor(s / 86400)} dia(s)`;
  }

  let booted = false;
  function start() { if (booted) return; booted = true; boot(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
