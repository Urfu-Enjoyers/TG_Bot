const tg = window.Telegram?.WebApp;
if (tg) {
  tg.expand();
  tg.ready();
}

const state = {
  initData: tg?.initData || '',
  me: null,
  rooms: [],
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function setActiveTab(tab) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  if (tab === 'profile') $('#screen-profile').classList.add('active');
  if (tab === 'rooms') $('#screen-rooms').classList.add('active');
  $$('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.nav-btn[data-tab="${tab}"]`).classList.add('active');
}

async function api(path, opts={}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-init-data': state.initData,
      ...(opts.headers || {})
    }
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function renderMe() {
  const u = state.me?.user || {};
  $('#userChip').textContent = u.name || u.username || ('ID ' + u.tg_id);
  $('#f_name').value = u.name || '';
  $('#f_bio').value = u.bio || '';
  $('#f_group').value = u.group_no || '';
  $('#f_github').value = u.github || '';
  $('#f_gitverse').value = u.gitverse || '';
  $('#f_linkedin').value = u.linkedin || '';

  const port = state.me?.portfolio || { projects: [], certificates: [] };
  const portfolioList = $('#portfolioList');
  portfolioList.innerHTML = '';
  if (port.projects.length === 0) {
    portfolioList.innerHTML = `<div class="item"><div><h4>Пока нет проектов</h4><div class="meta">Присоединяйтесь к комнате в разделе "Комнаты"</div></div></div>`;
  } else {
    port.projects.forEach(p => {
      const el = document.createElement('div');
      el.className = 'item';
      el.innerHTML = `
        <div>
          <h4>${p.title}</h4>
          <div class="meta">Статус: ${p.status} • Сложность: ${p.difficulty || 1} • Дедлайн: ${p.deadline ? new Date(p.deadline).toLocaleDateString() : '-'}</div>
        </div>
      `;
      portfolioList.appendChild(el);
    });
  }

  const certList = $('#certList');
  certList.innerHTML = '';
  if (port.certificates.length > 0) {
    port.certificates.forEach(c => {
      const el = document.createElement('div');
      el.className = 'item';
      el.innerHTML = `
        <div>
          <h4>Сертификат • ${c.room_title}</h4>
          <div class="meta">${c.certificate_no}</div>
        </div>
        <a class="btn accent" href="${c.url}" target="_blank" rel="noopener">PDF</a>
      `;
      certList.appendChild(el);
    });
  }
}

// Шкала сложности: генератор HTML
function difficultyScaleHTML(value = 1, { small = false, interactive = false, id = '' } = {}) {
  const cls = ['diff-scale', small ? 'sm' : '', interactive ? 'interactive' : ''].filter(Boolean).join(' ');
  const segs = [1,2,3,4,5].map(i => `
    <div class="diff-seg ${value >= i ? 'on' : ''}"
         data-i="${i}"
         ${interactive ? 'role="button" tabindex="0" aria-label="Сложность ${i} из 5"' : 'aria-hidden="true"'}
         title="${i} из 5"></div>
  `).join('');
  return `<div class="${cls}" ${id ? `id="${id}"` : ''} data-value="${value}">${segs}</div>`;
}

// Привязка интерактива к шкале (клики/стрелки)
function bindInteractiveScale(el){
  const setVal = (v) => {
    v = Math.max(1, Math.min(5, Number(v) || 1));
    el.dataset.value = String(v);
    el.querySelectorAll('.diff-seg').forEach(seg => {
      const i = Number(seg.dataset.i);
      seg.classList.toggle('on', i <= v);
    });
  };
  el.addEventListener('click', (e) => {
    const seg = e.target.closest('.diff-seg');
    if (!seg) return;
    setVal(seg.dataset.i);
  });
  el.addEventListener('keydown', (e) => {
    const cur = Number(el.dataset.value || 1);
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); setVal(cur + 1); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); setVal(cur - 1); }
    if (e.key === 'Home') { e.preventDefault(); setVal(1); }
    if (e.key === 'End') { e.preventDefault(); setVal(5); }
  });
  return setVal;
}

function renderRooms() {
  const list = $('#roomsList');
  list.innerHTML = '';

  // Скрываем завершённые/закрытые комнаты
  const visibleRooms = (state.rooms || []).filter(r => {
    const s = (r.status || '').toLowerCase();
    return !['completed', 'closed', 'archived', 'done'].includes(s);
  });

  if (!visibleRooms.length) {
    list.innerHTML = `<div class="item"><div><h4>Пока нет комнат</h4><div class="meta">Создайте первую или попробуйте позже</div></div></div>`;
    return;
  }

  visibleRooms.forEach(r => {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <div>
        <h4>${r.title}</h4>
        <div class="meta">Сложность: ${'★'.repeat(r.difficulty || 1)}${'☆'.repeat(Math.max(0, 5-(r.difficulty||1)))} • Набор до: ${r.intake_deadline ? new Date(r.intake_deadline).toLocaleDateString() : '—'}</div>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn" data-room="${r.id}" data-action="view">Подробнее</button>
      </div>
    `;
    list.appendChild(el);
  });

  list.querySelectorAll('button[data-action="view"]').forEach(btn => {
    btn.addEventListener('click', () => openRoomModal(Number(btn.dataset.room)));
  });
}

function openModal(title, bodyHTML) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = bodyHTML;
  $('#modal').classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); }

async function openRoomModal(roomId) {
  const { room, members, isAdmin, requests, myRequest } = await api(`/api/rooms/${roomId}`);
  const membersHtml = (members || []).map(m => `<span class="badge">${m.name || m.username || ('ID '+m.tg_id)}${m.role==='admin'?' • админ':''}</span>`).join(' ');

  const adminControls = isAdmin ? `
    <div class="card" style="margin-top:10px;">
      <h4>Заявки</h4>
      <div id="requestsList">
        ${requests?.length ? '' : '<div class="meta" id="noRequestsMsg">Нет заявок</div>'}
        ${(requests || []).map(r => `
          <div class="item" data-req-item="${r.id}">
            <div>
              <div><b class="req-name">${r.name || r.username || ('ID ' + r.tg_id)}</b></div>
              <div class="meta req-status">Статус: ${r.status} • ${new Date(r.created_at).toLocaleString()}</div>
            </div>
            <div style="display:flex; gap:8px;">
              <button class="btn danger" data-req="${r.id}" data-act="reject">Отклонить</button>
              <button class="btn primary" data-req="${r.id}" data-act="approve">Одобрить</button>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="actions">
        <button class="btn primary" id="btnCompleteProject">Завершить проект (сертификаты)</button>
      </div>
    </div>
  ` : '';

  openModal(room.title, `
    <div class="card">
      <div class="meta">Сложность: ${room.difficulty || 1} | Дедлайн: ${room.deadline ? new Date(room.deadline).toLocaleDateString() : '—'}</div>
      <p style="white-space:pre-wrap">${room.description || ''}</p>
      <div class="meta">Требования: ${room.requirements || '—'}</div>
      <div class="meta">Техстек: ${room.tech_stack || '—'}</div>
      <div style="margin-top:8px;">Участники: <span id="membersContainer">${membersHtml || '—'}</span></div>
      ${isAdmin ? '' : `
        <div class="actions" style="margin-top:12px;" id="joinArea">
          ${
            myRequest?.status === 'pending'
              ? '<span class="chip">Заявка отправлена ⏳</span>'
              : myRequest?.status === 'approved'
                ? '<span class="chip" style="color:#00e0a4;border-color:#00e0a4">Вы в проекте ✅</span>'
                : '<button class="btn primary" id="btnJoinRoom">Откликнуться</button>'
          }
        </div>
      `}
    </div>
    ${adminControls}
  `);

  // Отклик участника
  $('#btnJoinRoom')?.addEventListener('click', async () => {
    const btn = $('#btnJoinRoom');
    btn.disabled = true;
    try {
      await api(`/api/rooms/${roomId}/join`, { method: 'POST', body: JSON.stringify({}) });
      $('#joinArea').innerHTML = '<span class="chip">Заявка отправлена ⏳</span>';
    } catch (e) {
      alert('Не удалось отправить заявку');
      btn.disabled = false;
    }
  });

  // Обработка заявок (для админа)
  const requestsList = $('#requestsList');
  requestsList?.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.req);
      const action = btn.dataset.act; // 'approve' | 'reject'
      btn.disabled = true;

      try {
        const res = await api(`/api/rooms/${roomId}/requests/${id}`, {
          method: 'POST',
          body: JSON.stringify({ action })
        });

        // UI: убрать плашку заявки
        const item = requestsList.querySelector(`[data-req-item="${id}"]`);
        if (item) item.remove();

        // При approve — добавить участника визуально
        if (action === 'approve' && res?.applicant) {
          const mc = $('#membersContainer');
          const label = res.applicant.name || res.applicant.username || ('ID ' + res.applicant.tg_id) || 'Участник';
          const span = document.createElement('span');
          span.className = 'badge';
          span.textContent = label;
          mc?.appendChild(document.createTextNode(' '));
          mc?.appendChild(span);
        }

        // Если заявок больше нет — показать заглушку
        if (requestsList && !requestsList.querySelector('[data-req-item]')) {
          if (!requestsList.querySelector('#noRequestsMsg')) {
            const empty = document.createElement('div');
            empty.className = 'meta';
            empty.id = 'noRequestsMsg';
            empty.textContent = 'Нет заявок';
            requestsList.appendChild(empty);
          }
        }
      } catch (e) {
        alert('Не удалось обработать заявку');
        btn.disabled = false;
      }
    });
  });

  // Завершение проекта
  $('#btnCompleteProject')?.addEventListener('click', async () => {
    if (!confirm('Завершить проект и сгенерировать сертификаты всем участникам?')) return;
    try {
      const r = await api(`/api/rooms/${roomId}/complete`, { method: 'POST', body: JSON.stringify({}) });
      const links = r.certificates.map(c => `${c.certificate_no}: ${c.url}`).join('\n');
      alert('Сертификаты созданы:\n' + links);
      await loadRooms();      // обновить список, чтобы комната пропала
      closeModal();
      setActiveTab('rooms');
    } catch (e) {
      alert('Не удалось завершить проект');
    }
  });
}

function openCreateRoomModal() {
  openModal('Создать комнату', `
    <div class="grid">
      <label>Название
        <input id="cr_title" type="text" placeholder="Например: Telegram‑бот для кампуса" maxlength="120" />
      </label>

      <label>Сложность
        ${difficultyScaleHTML(2, { interactive: true, id: 'cr_diffScale' })}
      </label>

      <label>Набор до
        <input id="cr_intake" type="date" />
      </label>
      <label>Дедлайн проекта
        <input id="cr_deadline" type="date" />
      </label>

      <label>Краткое описание
        <textarea id="cr_desc" rows="3" maxlength="300" placeholder="Идея, цель и формат участия"></textarea>
      </label>
      <label>Требования к команде
        <textarea id="cr_req" rows="3" placeholder="Например: 2 backend, 1 дизайнер; базовые знания Git обязательны"></textarea>
      </label>
      <label>Техстек
        <input id="cr_stack" type="text" placeholder="Например: Python, FastAPI, PostgreSQL, Figma" />
      </label>
    </div>

    <div class="actions">
      <button class="btn primary" id="cr_create">Создать</button>
    </div>
  `);

  const diffEl = document.getElementById('cr_diffScale');
  bindInteractiveScale(diffEl);

  document.getElementById('cr_create').addEventListener('click', async () => {
    const payload = {
      title: document.getElementById('cr_title').value.trim(),
      difficulty: Number(diffEl.dataset.value || 1),
      intake_deadline: document.getElementById('cr_intake').value || null,
      deadline: document.getElementById('cr_deadline').value || null,
      description: document.getElementById('cr_desc').value || '',
      requirements: document.getElementById('cr_req').value || '',
      tech_stack: document.getElementById('cr_stack').value || ''
    };
    try {
      await api('/api/rooms', { method: 'POST', body: JSON.stringify(payload) });
      await loadRooms();
      closeModal();
      setActiveTab('rooms');
    } catch (e) {
      alert('Не удалось создать комнату');
    }
  });
}

async function loadMe() {
  const data = await api('/api/me');
  state.me = data;
  renderMe();
}
async function loadRooms() {
  const data = await api('/api/rooms');
  state.rooms = data.rooms || [];
  renderRooms();
}

function setupUI() {
  // Навигация
  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
  });

  // Сохранение профиля
  $('#btnSaveProfile').addEventListener('click', async () => {
    const payload = {
      name: $('#f_name').value,
      bio: $('#f_bio').value,
      group_no: $('#f_group').value,
      github: $('#f_github').value,
      gitverse: $('#f_gitverse').value,
      linkedin: $('#f_linkedin').value
    };
    try {
      const res = await api('/api/me', { method: 'PUT', body: JSON.stringify(payload) });
      state.me.user = res.user;
      renderMe();
      alert('Профиль сохранён');
    } catch (e) {
      alert('Ошибка сохранения профиля');
    }
  });

  // Создание комнаты
  $('#btnOpenCreateRoom').addEventListener('click', openCreateRoomModal);

  // Модалка
  $('#modalClose').addEventListener('click', closeModal);
}

(async function init(){
  if (!state.initData) {
    // Для локальной отладки (без Telegram), можно отключить по желанию:
    alert('Откройте приложение внутри Telegram для полной функциональности.');
  }
  setupUI();
  await loadMe();
  await loadRooms();
})();