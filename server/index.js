require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const db = require('./db');
const { verifyInitData } = require('./auth');
const { generateCertificate, certDir } = require('./certificates');
const { launchBot, notifyJoinRequest } = require('../bot/bot');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ----------------- Telegram Auth middleware -----------------
function tgAuth(req, res, next) {
  const DEV_BYPASS = process.env.DEV_BYPASS_TG === '1';
  const initData = req.header('x-telegram-init-data') || req.body?.initData;

  // DEV-режим: разрешаем без Telegram (для локальной отладки фронта в браузере)
  if (!initData && DEV_BYPASS) {
    let user = db.prepare('SELECT * FROM users WHERE tg_id = ?').get('dev-000');
    if (!user) {
      const info = db.prepare(`
        INSERT INTO users (tg_id, first_name, last_name, username, name)
        VALUES (?, ?, ?, ?, ?)
      `).run('dev-000', 'Dev', 'User', 'devuser', 'Dev User');
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    }
    req.tgUser = { id: 'dev-000', first_name: 'Dev', last_name: 'User', username: 'devuser' };
    req.user = user;
    return next();
  }

  if (!initData) {
    console.warn('[tgAuth] NO_INIT_DATA');
    return res.status(401).json({ ok: false, error: 'NO_INIT_DATA' });
  }

  if (!process.env.BOT_TOKEN) {
    console.error('[tgAuth] Missing BOT_TOKEN in .env');
    return res.status(500).json({ ok: false, error: 'SERVER_MISCONFIGURED' });
  }

  const { ok, tgUser } = verifyInitData(initData, process.env.BOT_TOKEN);
  if (!ok || !tgUser?.id) {
    console.warn('[tgAuth] BAD_INIT_DATA');
    return res.status(401).json({ ok: false, error: 'BAD_INIT_DATA' });
  }

  const tg_id = tgUser.id.toString();
  let user = db.prepare('SELECT * FROM users WHERE tg_id = ?').get(tg_id);
  const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || null;

  if (!user) {
    const ins = db.prepare(`
      INSERT INTO users (tg_id, first_name, last_name, username, name)
      VALUES (?, ?, ?, ?, ?)
    `);
    const info = ins.run(
      tg_id,
      tgUser.first_name || null,
      tgUser.last_name || null,
      tgUser.username || null,
      name
    );
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  } else {
    db.prepare(`
      UPDATE users
      SET first_name=?, last_name=?, username=?, name=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(
      tgUser.first_name || null,
      tgUser.last_name || null,
      tgUser.username || null,
      name,
      user.id
    );
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  }

  req.tgUser = tgUser;
  req.user = user;
  next();
}

// Применяем авторизацию ко всем /api
app.use('/api', tgAuth);

// ----------------- API -----------------

// Текущий пользователь + портфолио
app.get('/api/me', (req, res) => {
  const user = req.user;

  const memberOf = db.prepare(`
    SELECT r.id, r.title, r.status, r.difficulty, r.deadline
    FROM room_members rm
    JOIN rooms r ON r.id = rm.room_id
    WHERE rm.user_id = ?
    ORDER BY r.created_at DESC
  `).all(user.id);

  const certs = db.prepare(`
    SELECT c.id, c.room_id, c.certificate_no, c.file_path, c.issued_at, r.title AS room_title
    FROM certificates c
    JOIN rooms r ON r.id = c.room_id
    WHERE c.user_id = ?
    ORDER BY c.issued_at DESC
  `).all(user.id);

  res.json({
    ok: true,
    user,
    portfolio: {
      projects: memberOf,
      certificates: certs.map(c => ({
        id: c.id,
        certificate_no: c.certificate_no,
        room_id: c.room_id,
        room_title: c.room_title,
        url: `${process.env.PUBLIC_URL || ''}/certificates/${path.basename(c.file_path)}`
      }))
    }
  });
});

// Обновить профиль
app.put('/api/me', (req, res) => {
  const { name, bio, group_no, github, gitverse, linkedin } = req.body || {};
  db.prepare(`
    UPDATE users SET
      name = COALESCE(?, name),
      bio = COALESCE(?, bio),
      group_no = COALESCE(?, group_no),
      github = COALESCE(?, github),
      gitverse = COALESCE(?, gitverse),
      linkedin = COALESCE(?, linkedin),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name ?? null,
    bio ?? null,
    group_no ?? null,
    github ?? null,
    gitverse ?? null,
    linkedin ?? null,
    req.user.id
  );

  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, user: fresh });
});

// Список открытых комнат
app.get('/api/rooms', (req, res) => {
  const rooms = db.prepare(`
    SELECT r.*, u.name AS admin_name, u.tg_id AS admin_tg_id
    FROM rooms r
    JOIN users u ON u.id = r.admin_user_id
    WHERE r.status IN ('open', 'active')
    ORDER BY r.created_at DESC
  `).all();
  res.json({ ok: true, rooms });
});

// Создать комнату
app.post('/api/rooms', (req, res) => {
  const { title, description, difficulty, intake_deadline, deadline, requirements, tech_stack } = req.body || {};
  if (!title || String(title).trim().length < 3) {
    return res.status(400).json({ ok: false, error: 'TITLE_TOO_SHORT' });
  }

  const info = db.prepare(`
    INSERT INTO rooms (title, description, difficulty, intake_deadline, deadline, requirements, tech_stack, admin_user_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')
  `).run(
    title.trim(),
    description ?? null,
    Number.isFinite(difficulty) ? Number(difficulty) : 1,
    intake_deadline ?? null,
    deadline ?? null,
    requirements ?? null,
    tech_stack ?? null,
    req.user.id
  );

  db.prepare('INSERT OR IGNORE INTO room_members(room_id, user_id, role) VALUES (?,?,?)')
    .run(info.lastInsertRowid, req.user.id, 'admin');

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(info.lastInsertRowid);
  res.json({ ok: true, room });
});

// Детали комнаты (с myRequest и заявками для админа)
app.get('/api/rooms/:id', (req, res) => {
  const id = Number(req.params.id);
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
  if (!room) return res.status(404).json({ ok: false, error: 'ROOM_NOT_FOUND' });

  const members = db.prepare(`
    SELECT u.id, u.name, u.username, u.tg_id, rm.role
    FROM room_members rm
    JOIN users u ON u.id = rm.user_id
    WHERE rm.room_id = ?
    ORDER BY (rm.role = 'admin') DESC, u.name ASC
  `).all(id);

  const isAdmin = room.admin_user_id === req.user.id;

  let requests = [];
  if (isAdmin) {
    requests = db.prepare(`
      SELECT jr.id, u.name, u.username, u.tg_id, jr.status, jr.created_at
      FROM join_requests jr
      JOIN users u ON u.id = jr.user_id
      WHERE jr.room_id = ?
      ORDER BY jr.created_at ASC
    `).all(id);
  }

  const myReq = db.prepare(
    'SELECT status FROM join_requests WHERE room_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1'
  ).get(id, req.user.id) || null;

  res.json({ ok: true, room, members, isAdmin, requests, myRequest: myReq });
});

// Подать заявку
app.post('/api/rooms/:id/join', async (req, res) => {
  const id = Number(req.params.id);
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
  if (!room) return res.status(404).json({ ok: false, error: 'ROOM_NOT_FOUND' });
  if (!['open', 'active'].includes(room.status)) {
    return res.status(400).json({ ok: false, error: 'ROOM_CLOSED' });
  }

  const alreadyMember = db.prepare('SELECT 1 FROM room_members WHERE room_id=? AND user_id=?').get(id, req.user.id);
  if (alreadyMember) return res.status(400).json({ ok: false, error: 'ALREADY_MEMBER' });

  const existsPending = db.prepare("SELECT 1 FROM join_requests WHERE room_id=? AND user_id=? AND status='pending'").get(id, req.user.id);
  if (existsPending) return res.status(400).json({ ok: false, error: 'ALREADY_REQUESTED' });

  const ins = db.prepare("INSERT INTO join_requests (room_id, user_id, status) VALUES (?, ?, 'pending')").run(id, req.user.id);
  const requestId = ins.lastInsertRowid;

  // Уведомление админу через бота
  try {
    const admin = db.prepare('SELECT u.tg_id, u.name FROM users u WHERE u.id = ?').get(room.admin_user_id);
    await notifyJoinRequest({
      adminTgId: admin.tg_id,
      requestId,
      applicantName: req.user.name || req.user.username || ('ID ' + req.user.tg_id),
      applicantUsername: req.user.username,
      roomTitle: room.title
    });
  } catch (e) {
    console.error('notifyJoinRequest error:', e?.message);
  }

  res.json({ ok: true, requestId });
});

// Обработка заявки (approve/reject)
app.post('/api/rooms/:id/requests/:requestId', (req, res) => {
  const roomId = Number(req.params.id);
  const requestId = Number(req.params.requestId);
  const { action } = req.body || {};

  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ ok: false, error: 'BAD_ACTION' });
  }

  const request = db.prepare(`
    SELECT jr.*, r.title as room_title, r.admin_user_id,
           u.tg_id as applicant_tg_id, u.name as applicant_name, u.username as applicant_username
    FROM join_requests jr
    JOIN rooms r ON r.id = jr.room_id
    JOIN users u ON u.id = jr.user_id
    WHERE jr.id = ? AND jr.room_id = ?
  `).get(requestId, roomId);

  if (!request) return res.status(404).json({ ok: false, error: 'REQUEST_NOT_FOUND' });
  if (request.admin_user_id !== req.user.id) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
  if (request.status !== 'pending') return res.status(409).json({ ok: false, error: 'ALREADY_PROCESSED' });

  const now = new Date().toISOString();

  if (action === 'approve') {
    db.prepare('UPDATE join_requests SET status = ?, updated_at = ? WHERE id = ?')
      .run('approved', now, requestId);
    db.prepare('INSERT OR IGNORE INTO room_members(room_id, user_id, role) VALUES(?,?,?)')
      .run(request.room_id, request.user_id, 'member');

    return res.json({
      ok: true,
      status: 'approved',
      applicant: {
        tg_id: request.applicant_tg_id,
        name: request.applicant_name,
        username: request.applicant_username
      }
    });
  } else {
    db.prepare('UPDATE join_requests SET status = ?, updated_at = ? WHERE id = ?')
      .run('rejected', now, requestId);
    return res.json({ ok: true, status: 'rejected' });
  }
});

// Завершить проект (сертификаты)
app.post('/api/rooms/:id/complete', async (req, res) => {
  const id = Number(req.params.id);
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
  if (!room) return res.status(404).json({ ok: false, error: 'ROOM_NOT_FOUND' });
  if (room.admin_user_id !== req.user.id) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });

  db.prepare("UPDATE rooms SET status='completed' WHERE id=?").run(id);

  const members = db.prepare(`
    SELECT u.* FROM room_members rm
    JOIN users u ON u.id = rm.user_id
    WHERE rm.room_id = ?
  `).all(id);

  const created = [];
  for (const u of members) {
    const certificateNo = `PH-${String(id).padStart(4,'0')}-${String(u.id).padStart(4,'0')}-${Date.now().toString().slice(-6)}`;
    const { filePath } = await generateCertificate({ user: u, room, certificateNo });
    db.prepare('INSERT INTO certificates (room_id, user_id, certificate_no, file_path) VALUES (?,?,?,?)')
      .run(id, u.id, certificateNo, filePath);
    created.push({ user_id: u.id, certificate_no: certificateNo, path: filePath });
  }

  res.json({
    ok: true,
    certificates: created.map(c => ({
      user_id: c.user_id,
      certificate_no: c.certificate_no,
      url: `${process.env.PUBLIC_URL || ''}/certificates/${path.basename(c.path)}`
    }))
  });
});

// Выдача PDF сертификатов
app.use('/certificates', express.static(certDir));

// Статика фронта
app.use('/', express.static(path.join(__dirname, '..', 'web')));

// --------------- Start ---------------
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

// Telegram-бот
launchBot();