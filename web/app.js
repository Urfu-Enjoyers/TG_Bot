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

// ===== ВСПОМОГАТЕЛЬНЫЕ УТИЛИТЫ ДЛЯ ПРОФИЛЯ =====
function extractUserish(obj) {
  const candidates = [
    obj?.applicant,
    obj?.applicant_profile,
    obj?.user,
    obj?.profile,
    obj?.data,
    obj?.result,
    obj?.request?.applicant,
    obj?.request?.applicant_profile,
    obj?.request?.user,
    obj?.request?.profile,
    obj?.request?.data,
    obj
  ];
  for (const u of candidates) {
    if (u && typeof u === 'object') {
      const hasAny = ['bio','about','group_no','github','gitverse','linkedin','name','username','tg_id']
        .some(k => u[k]);
      if (hasAny) return u;
    }
  }
  return null;
}


function getTgIdFromAny(obj, fallback='') {
  const ids = [
    fallback,
    obj?.tg_id,
    obj?.applicant?.tg_id,
    obj?.user?.tg_id,
    obj?.profile?.tg_id,
    obj?.data?.tg_id,
    obj?.request?.tg_id,
    obj?.request?.applicant?.tg_id,
    obj?.request?.user?.tg_id,
    obj?.request?.profile?.tg_id,
  ].map(x => String(x ?? '').trim()).filter(Boolean);
  for (const id of ids) {
    if (/^\d+$/.test(id)) return id;
  }
  return '';
}

function uniq(arr) { return [...new Set(arr)]; }

// Try to load user profile by Telegram ID from several possible endpoints
async function fetchApplicantProfileByTgId(tgId) {
  const id = String(tgId ?? '').trim();
  if (!/^\d+$/.test(id)) return null;

  const candidates = uniq([
    `/api/users/${id}`,
    `/api/users/by-tg/${id}`,
    `/api/user/${id}`,
    `/api/users?tg_id=${encodeURIComponent(id)}`,
    `/api/applicants/${id}`,
    `/api/applicants/by-tg/${id}`,
    `/api/applicants?tg_id=${encodeURIComponent(id)}`,
    `/api/profiles/by-tg/${id}`,
    `/api/profiles?tg_id=${encodeURIComponent(id)}`,
    `/api/profile/${id}`,
  ]);

  for (const url of candidates) {
    try {
      const res = await api(url);
      const u = extractUserish(res);
      if (u) return u;
    } catch (e) {
      // try next
    }
  }
  return null;
}

function setActiveTab(tab) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  if (tab === 'profile') $('#screen-profile').classList.add('active');
  if (tab === 'rooms') $('#screen-rooms').classList.add('active');
  $$('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.nav-btn[data-tab="${tab}"]`).classList.add('active');
}

async function api(path, opts={}) {
  const res = await fetch(path, {
    credentials: 'include', // важно: передаём cookies/сессию
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-init-data': state.initData || '',
      ...(opts.headers || {})
    }
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + path);
  if (res.status === 204) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
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
          <div class="meta">Статус: ${p.status} • Сложность: ${difficultyScaleHTML(p.difficulty || 1, { small: true })} • Дедлайн: ${p.deadline ? new Date(p.deadline).toLocaleDateString() : '-'}</div>
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

// ===== Обязательные поля и валидация =====
function validateProfileFields() {
  const nameEl = $('#f_name');
  const groupEl = $('#f_group');
  const bioEl = $('#f_bio');
  const btn = $('#btnSaveProfile'); 
 
  const nameOk = !!nameEl && nameEl.value.trim().length >= 2; // минимум 2 символа
  const groupOk = !!groupEl && groupEl.value.trim().length >= 1;
  const bioOk = !!bioEl && bioEl.value.trim().length >= 1;
  if (nameEl) nameEl.classList.toggle('input-invalid', !nameOk);
  if (groupEl) groupEl.classList.toggle('input-invalid', !groupOk);
  if (bioEl) bioEl.classList.toggle('input-invalid', !bioOk);
  const ok = nameOk && groupOk && bioOk;
  if (btn) btn.disabled = !ok;
  return ok;
}

function attachProfileValidation() {
  ['#f_name', '#f_group', '#f_bio'].forEach(sel => {
    const el = $(sel);
    if (el) el.addEventListener('input', validateProfileFields);
  });
  validateProfileFields();
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
    // Обрезаем название до 25 символов с многоточием
    const truncatedTitle = r.title.length > 25 ? r.title.substring(0, 25) + '...' : r.title;
    el.innerHTML = `
      <div>
        <h4>${truncatedTitle}</h4>
        <div class="meta">Сложность: ${difficultyScaleHTML(r.difficulty || 1, { small: true })} • Набор до: ${r.intake_deadline ? new Date(r.intake_deadline).toLocaleDateString() : '—'}</div>
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
  document.body.classList.add('modal-open'); // блокируем скролл фона
}

function closeModal() {
  $('#modal').classList.add('hidden');
  document.body.classList.remove('modal-open'); // возвращаем скролл фона
}

async function openRoomModal(roomId) {
  const { room, members, isAdmin, requests, myRequest } = await api(`/api/rooms/${roomId}`);

  const membersHtml = (members || []).map(m => `
    <span class="badge ${m.role === 'admin' ? 'admin' : ''}">
      ${m.name || m.username || ('ID ' + m.tg_id)}${m.role === 'admin' ? ' • админ' : ''}
    </span>
  `).join(' ');

  const intakeStr = room.intake_deadline ? new Date(room.intake_deadline).toLocaleDateString() : null;
  const deadlineStr = room.deadline ? new Date(room.deadline).toLocaleDateString() : null;

  const nonApprovedRequests = (requests || []).filter(r => r.status !== 'approved');

  // карта заявок для быстрого доступа к исходным данным r внутри обработчиков
  const reqMap = new Map((nonApprovedRequests || []).map(r => [String(r.id), r]));

  const adminControls = isAdmin ? `
    <div class="section">
      <div class="section-title">Заявки</div>
      <div id="requestsList">
        ${nonApprovedRequests.length ? '' : '<div class="meta" id="noRequestsMsg">Нет заявок</div>'}
        ${nonApprovedRequests.map(r => {
          const statusCls =
            r.status === 'approved' ? 'approved' :
            r.status === 'pending' ? 'pending' :
            r.status === 'rejected' ? 'rejected' : '';
          return `
            <div class="item" data-req-item="${r.id}">
              <div>
                <div><b class="req-name">${r.name || r.username || ('ID ' + r.tg_id)}</b></div>
                <div class="req-status ${statusCls}">Статус: ${r.status} • ${new Date(r.created_at).toLocaleString()}</div>
              </div>
              <div class="actions">
                <button class="btn" data-req="${r.id}" data-act="info" data-tg="${r.tg_id || ''}">Профиль</button>
                <button class="btn danger" data-req="${r.id}" data-act="reject">Отклонить</button>
                <button class="btn primary" data-req="${r.id}" data-act="approve">Одобрить</button>
              </div>
              <div class="req-details hidden" id="reqd_${r.id}" aria-hidden="true">
                ${(() => {
                  const bio = r.bio || r.about || '';
                  const group = r.group_no || '';
                  const github = r.github || '';
                  const gitverse = r.gitverse || '';
                  const linkedin = r.linkedin || '';
                  if (bio || group || github || gitverse || linkedin) {
                    return `
                      <div class="grid" style="margin-top:8px">
                        ${bio ? `<div><div class=\"meta\">О себе</div><div>${bio}</div></div>` : ''}
                        ${group ? `<div><div class=\"meta\">Группа</div><div>${group}</div></div>` : ''}
                        ${github ? `<div><div class=\"meta\">GitHub</div><div><a href=\"${github}\" target=\"_blank\" rel=\"noopener\">${github}</a></div></div>` : ''}
                        ${gitverse ? `<div><div class=\"meta\">GitVerse</div><div><a href=\"${gitverse}\" target=\"_blank\" rel=\"noopener\">${gitverse}</a></div></div>` : ''}
                        ${linkedin ? `<div><div class=\"meta\">LinkedIn</div><div><a href=\"${linkedin}\" target=\"_blank\" rel=\"noopener\">${linkedin}</a></div></div>` : ''}
                      </div>
                    `;
                  }
                  return `<div class=\"meta\" style=\"margin-top:8px\">Загрузка…</div>`;
                })()}
              </div>
            </div>
          `;
        }).join('')}
      </div>
      <div class="divider"></div>
      <div class="actions">
        <button class="btn primary" id="btnCompleteProject">Завершить проект (сертификаты)</button>
      </div>
    </div>
  ` : '';

  openModal(room.title, `
    <div class="room-hero">
      <div class="kpis">
        <div class="tags">
          <span class="tag"><span class="dot"></span> Сложность: ${difficultyScaleHTML(room.difficulty || 1, { small: true })}</span>
          ${intakeStr ? `<span class="tag deadline">Набор до: ${intakeStr}</span>` : ''}
          ${deadlineStr ? `<span class="tag danger">Дедлайн: ${deadlineStr}</span>` : ''}
        </div>
      </div>
    </div>
  
    <div class="section">
      <div class="info-grid">
        <div class="info-block">
          <h5>Описание</h5>
          <p>${room.description || '—'}</p>
        </div>
        <div class="info-block">
          <h5>Требования</h5>
          <p>${room.requirements || '—'}</p>
        </div>
        <div class="info-block" style="grid-column: 1 / -1;">
          <h5>Техстек</h5>
          <p>${room.tech_stack || '—'}</p>
        </div>
      </div>
    </div>
  
    <div class="section">
      <div class="section-title">Участники</div>
      <div class="members-row" id="membersContainer">${membersHtml || '—'}</div>
      ${isAdmin ? '' : `
        <div class="actions" id="joinArea">
          ${
            myRequest?.status === 'pending'
              ? '<span class="chip">Заявка отправлена ⏳</span>'
              : myRequest?.status === 'approved'
                ? '<span class="chip" style="color:#00e0a4;border-color:#00e0a4">Вы в проекте ✅</span>'
                : '<button class="btn primary block" id="btnJoinRoom">Откликнуться</button>'
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
  requestsList?.querySelectorAll('[data-act="approve"], [data-act="reject"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.req);
      const action = btn.dataset.act; // 'approve' | 'reject'
      btn.disabled = true;

      try {
        const res = await api(`/api/rooms/${roomId}/requests/${id}`, {
          method: 'POST',
          body: JSON.stringify({ action })
        });

        // убрать заявку из списка
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

  // Просмотр профиля заявителя ("О себе" и ссылки)
  requestsList?.querySelectorAll('[data-act="info"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = String(btn.dataset.req);
      const rawTgId = btn.dataset.tg || '';
      const details = document.getElementById(`reqd_${id}`);
      if (!details) return;

      const isHidden = details.classList.contains('hidden');
      if (isHidden) {
        // Разворачиваем
        details.classList.remove('hidden');
        details.setAttribute('aria-hidden', 'false');

        // Если нужно загрузить с сервера
        if (details.textContent && details.textContent.includes('Загрузка')) {
          try {
            // 0) Попытка взять из исходной заявки (если там уже есть поля)
            const src = reqMap.get(id) || null;
            let u = extractUserish(src);
            let tgId = getTgIdFromAny(src, rawTgId);

            // 1) Пробуем точечный эндпоинт заявки
            if (!u) {
              try {
                const reqDetails = await api(`/api/rooms/${roomId}/requests/${id}`);
                u = extractUserish(reqDetails) || u;
                tgId = getTgIdFromAny(reqDetails, tgId);
              } catch (e) {
                // fallback ниже
              }
            }

            // 2) Fallback: ищем по tg_id разными эндпоинтами
            if (!u && tgId) {
              u = await fetchApplicantProfileByTgId(tgId);
            }

            // Финальная нормализация
            u = extractUserish(u);

            // Если не нашли профиль — выводим заглушку и выходим
            if (!u) {
              details.innerHTML = '<div class="meta" style="margin-top:8px">Профиль не найден или не заполнен</div>';
              return;
            }

            // Безопасное чтение полей
            const bio = u?.bio || u?.about || '';
            const group = u?.group_no || '';
            const github = u?.github || '';
            const gitverse = u?.gitverse || '';
            const linkedin = u?.linkedin || '';
            const hasAny = !!(bio || group || github || gitverse || linkedin);

            details.innerHTML = hasAny ? `
              <div class="grid" style="margin-top:8px">
                ${bio ? `<div><div class="meta">О себе</div><div>${bio}</div></div>` : ''}
                ${group ? `<div><div class="meta">Группа</div><div>${group}</div></div>` : ''}
                ${github ? `<div><div class="meta">GitHub</div><div><a href="${github}" target="_blank" rel="noopener">${github}</a></div></div>` : ''}
                ${gitverse ? `<div><div class="meta">GitVerse</div><div><a href="${gitverse}" target="_blank" rel="noopener">${gitverse}</a></div></div>` : ''}
                ${linkedin ? `<div><div class="meta">LinkedIn</div><div><a href="${linkedin}" target="_blank" rel="noopener">${linkedin}</a></div></div>` : ''}
              </div>
            ` : '<div class="meta" style="margin-top:8px">Профиль не найден или не заполнен</div>';
          } catch (e) {
            console.error('Profile load error', e);
            details.innerHTML = '<div class="meta" style="margin-top:8px;color:#ff5c5c">Не удалось загрузить профиль</div>';
          }
        }
      } else {
        // Сворачиваем
        details.classList.add('hidden');
        details.setAttribute('aria-hidden', 'true');
      }
    });
  });

  // Завершение проекта
  $('#btnCompleteProject')?.addEventListener('click', async () => {
    if (!confirm('Завершить проект и сгенерировать сертификаты всем участникам?')) return;
    try {
      const r = await api(`/api/rooms/${roomId}/complete`, { method: 'POST', body: JSON.stringify({}) });
      const links = (r?.certificates || []).map(c => `${c.certificate_no}: ${c.url}`).join('\n');
      alert('Сертификаты созданы:\n' + links);
      await loadRooms();
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
      <label>Название (не более 50 символов)
        <input id="cr_title" type="text" placeholder="Например: Telegram‑бот для кампуса" maxlength="50" required />
      </label>

      <label>Сложность
        ${difficultyScaleHTML(2, { interactive: true, id: 'cr_diffScale' })}
      </label>

      <label>Набор участников до (дата не должна быть позже дедлайна проекта)
        <input id="cr_intake" type="date" />
      </label>
      <label>Дедлайн проекта (дата не должна быть раньше даты набора участников)
        <input id="cr_deadline" type="date" />
      </label>

      <label>Краткое описание (не более 300 символов)
        <textarea id="cr_desc" rows="3" maxlength="300" placeholder="Идея, цель и формат участия" style="resize: none;"></textarea>
      </label>
      <label>Требования к команде (не более 300 символов)
        <textarea id="cr_req" rows="3" maxlength="300" placeholder="Например: 2 backend, 1 дизайнер; базовые знания Git обязательны" style="resize: none;"></textarea>
      </label>
      <label>Техстек (не более 300 символов)
        <input id="cr_stack" type="text" maxlength="300" placeholder="Например: Python, FastAPI, PostgreSQL, Figma" />
      </label>
    </div>

    <div class="actions">
      <button class="btn primary" id="cr_create" disabled>Создать</button>
    </div>
  `);

  // Привязываем интерактив к шкале
  const diffEl = document.getElementById('cr_diffScale');
  bindInteractiveScale(diffEl);

  // Валидация обязательных полей (название)
  const titleEl = document.getElementById('cr_title');
  const createBtn = document.getElementById('cr_create');
  const deadlineEl = document.getElementById('cr_deadline');
  const descEl = document.getElementById('cr_desc'); // краткое описание
  const reqEl = document.getElementById('cr_req'); // требования к команде
  const stackEl = document.getElementById('cr_stack'); // техстек
  const validateRoom = () => {
    const titleOk = titleEl.value.trim().length >= 3;
    const deadlineOk = deadlineEl.value !== '';
    const descOk = descEl.value.trim().length <= 300 && descEl.value !== '';
    const reqOk = reqEl.value.trim().length <= 300 && reqEl.value !== '';
    const stackOk = stackEl.value.trim().length <= 300 && stackEl.value !== '';
    
    titleEl.classList.toggle('input-invalid', !titleOk);
    deadlineEl.classList.toggle('input-invalid', !deadlineOk);
    descEl.classList.toggle('input-invalid', !descOk);
    reqEl.classList.toggle('input-invalid', !reqOk);
    stackEl.classList.toggle('input-invalid', !stackOk);
    
    const ok = titleOk && deadlineOk && descOk && reqOk && stackOk;
    createBtn.disabled = !ok;
    return ok;
  };
  titleEl.addEventListener('input', validateRoom);
  deadlineEl.addEventListener('input', validateRoom);
  descEl.addEventListener('input', validateRoom);
  reqEl.addEventListener('input', validateRoom);
  stackEl.addEventListener('input', validateRoom);
  validateRoom();

  document.getElementById('cr_create').addEventListener('click', async () => {
    if (!validateRoom()) {
      alert('Заполните обязательные поля: Название (не короче 3 символов), даты, описание, требования и техстек.');
      return;
    }
    const payload = {
      title: document.getElementById('cr_title').value.trim(),
      difficulty: Number(diffEl.dataset.value || 1),
      intake_deadline: document.getElementById('cr_intake').value || null,
      deadline: document.getElementById('cr_deadline').value || null,
      description: document.getElementById('cr_desc').value || '',
      requirements: document.getElementById('cr_req').value || '',
      tech_stack: document.getElementById('cr_stack').value || ''
    };

    // Дополнительно: проверка, что intake_deadline не позже deadline
    if (payload.intake_deadline && payload.deadline) {
      const intakeDate = new Date(payload.intake_deadline);
      const deadlineDate = new Date(payload.deadline);
      if (intakeDate > deadlineDate) {
        alert('Дата набора не может быть позже дедлайна проекта.');
        return;
      }
    }

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
  state.me = data || {};
  renderMe();
  validateProfileFields(); // Re-validate after loading and rendering data
}
async function loadRooms() {
  const data = await api('/api/rooms');
  state.rooms = data?.rooms || [];
  renderRooms();
}

function setupUI() {
  // Навигация
  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
  });

  // Валидация профиля (обязательные поля)
  attachProfileValidation();

  // Сохранение профиля
  $('#btnSaveProfile')?.addEventListener('click', async () => {
    if (!validateProfileFields()) {
      alert('Заполните обязательные поля профиля.');
      return;
    }
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
      state.me.user = res?.user || state.me?.user || {};
      renderMe();
      alert('Профиль сохранён');
    } catch (e) {
      alert('Ошибка сохранения профиля');
    }
  });

  // Создание комнаты
  $('#btnOpenCreateRoom')?.addEventListener('click', openCreateRoomModal);

  // Модалка
  $('#modalClose')?.addEventListener('click', closeModal);
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
