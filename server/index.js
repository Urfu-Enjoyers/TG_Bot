require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const dayjs = require('dayjs');

const db = require('./db');
const { verifyInitData } = require('./auth');
const { generateCertificate, certDir } = require('./certificates');
const { launchBot, notifyJoinRequest } = require('../bot/bot');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ВАЖНО: авторизация для всех /api-эндпоинтов (и тех, что в roomsRouter тоже)
app.use('/api', tgAuth);

// Подключаем роутер уже под защитой tgAuth
const roomsRouter = require('./routes/rooms');
app.use(roomsRouter);

// Статика как и была
app.use('/', express.static(path.join(__dirname, '..', 'web')));

// Middleware для верификации Telegram initData
function tgAuth(req, res, next) {
  const initData = req.header('x-telegram-init-data') || req.body?.initData;
  if (!initData) return res.status(401).json({ ok: false, error: 'NO_INIT_DATA' });
  const { ok, tgUser } = verifyInitData(initData, process.env.BOT_TOKEN);
  if (!ok || !tgUser?.id) return res.status(401).json({ ok: false, error: 'BAD_INIT_DATA' });
  
  const tg_id = tgUser.id.toString();
  let user = db.prepare('SELECT * FROM users WHERE tg_id = ?').get(tg_id);
  if (!user) {
  const ins = db.prepare(`INSERT INTO users (tg_id, first_name, last_name, username, name) VALUES (?, ?, ?, ?, ?)`);
  const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ');
  const info = ins.run(tg_id, tgUser.first_name || null, tgUser.last_name || null, tgUser.username || null, name || null);
  user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  } else {
  const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ');
  db.prepare("UPDATE users SET first_name=?, last_name=?, username=?, name=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
  .run(tgUser.first_name || null, tgUser.last_name || null, tgUser.username || null, name || null, user.id);
  user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  }
  
  req.tgUser = tgUser;
  req.user = user;
  next();
  }

// -------- API ----------
app.get('/api/me', tgAuth, (req, res) => {
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
        url: `${process.env.PUBLIC_URL}/certificates/${path.basename(c.file_path)}`
      }))
    }
  });
});

app.put('/api/me', tgAuth, (req, res) => {
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

app.get('/api/rooms', tgAuth, (req, res) => {
  const rooms = db.prepare(`
    SELECT r.*, u.name AS admin_name, u.tg_id AS admin_tg_id
    FROM rooms r
    JOIN users u ON u.id = r.admin_user_id
    WHERE r.status IN ('open', 'active')
    ORDER BY r.created_at DESC
  `).all();
  res.json({ ok: true, rooms });
});

app.post('/api/rooms', tgAuth, (req, res) => {
  const { title, description, difficulty, intake_deadline, deadline, requirements, tech_stack } = req.body || {};
  if (!title || String(title).trim().length < 3) return res.status(400).json({ ok: false, error: 'TITLE_TOO_SHORT' });

  const ins = db.prepare(`
    INSERT INTO rooms (title, description, difficulty, intake_deadline, deadline, requirements, tech_stack, admin_user_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')
  `);
  const info = ins.run(
    title.trim(),
    description ?? null,
    isFinite(difficulty) ? Number(difficulty) : 1,
    intake_deadline ?? null,
    deadline ?? null,
    requirements ?? null,
    tech_stack ?? null,
    req.user.id
  );

  // Создатель сразу становится участником (админ)
  db.prepare('INSERT OR IGNORE INTO room_members(room_id, user_id, role) VALUES (?,?,?)')
    .run(info.lastInsertRowid, req.user.id, 'admin');

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(info.lastInsertRowid);
  res.json({ ok: true, room });
});

app.get('/api/rooms/:id', tgAuth, (req, res) => {
  const id = Number(req.params.id);
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
  if (!room) return res.status(404).json({ ok: false, error: 'ROOM_NOT_FOUND' });

  const members = db.prepare(`
    SELECT u.id, u.name, u.username, u.tg_id, rm.role
    FROM room_members rm
    JOIN users u ON u.id = rm.user_id
    WHERE rm.room_id = ?
  `).all(id);

  const isAdmin = room.admin_user_id === req.user.id;

  let requests = [];
  if (isAdmin) {
    requests = db.prepare(`
      SELECT jr.id, u.name, u.username, u.tg_id, jr.status, jr.created_at
      FROM join_requests jr
      JOIN users u ON u.id = jr.user_id
      WHERE jr.room_id = ?
      ORDER BY jr.created_at DESC
    `).all(id);
  }

  res.json({ ok: true, room, members, isAdmin, requests });
});

app.post('/api/rooms/:id/join', tgAuth, async (req, res) => {
  const id = Number(req.params.id);
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
  if (!room) return res.status(404).json({ ok: false, error: 'ROOM_NOT_FOUND' });
  if (room.status !== 'open' && room.status !== 'active') return res.status(400).json({ ok: false, error: 'ROOM_CLOSED' });

  const alreadyMember = db.prepare('SELECT 1 FROM room_members WHERE room_id=? AND user_id=?').get(id, req.user.id);
  if (alreadyMember) return res.status(400).json({ ok: false, error: 'ALREADY_MEMBER' });

  const existsPending = db.prepare("SELECT 1 FROM join_requests WHERE room_id=? AND user_id=? AND status='pending'").get(id, req.user.id);
  if (existsPending) return res.status(400).json({ ok: false, error: 'ALREADY_REQUESTED' });

  const ins = db.prepare("INSERT INTO join_requests (room_id, user_id, status) VALUES (?, ?, 'pending')").run(id, req.user.id);
  const requestId = ins.lastInsertRowid;

  // Уведомление админу через бота
  const admin = db.prepare('SELECT u.tg_id, u.name FROM users u WHERE u.id = ?').get(room.admin_user_id);
  notifyJoinRequest({
    adminTgId: admin.tg_id,
    requestId,
    applicantName: req.user.name || req.user.username || ('ID ' + req.user.tg_id),
    roomTitle: room.title
  });

  res.json({ ok: true, requestId });
});

// Админ завершает проект -> генерируются сертификаты
app.post('/api/rooms/:id/complete', tgAuth, async (req, res) => {
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
    // уникальный номер сертификата
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
      url: `${process.env.PUBLIC_URL}/certificates/${path.basename(c.path)}`
    }))
  });
});

// Выдача PDF сертификатов
app.use('/certificates', express.static(certDir));

// --------------- Start ---------------
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

launchBot();