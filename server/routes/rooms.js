const express = require('express');
const router = express.Router();
const db = require('../db'); // скорректируйте путь под ваш проект

// Требуется миддлварь, которая из заголовка x-telegram-init-data заполняет req.user (id, tg_id)
router.post('/api/rooms/:roomId/requests/:requestId', (req, res) => {
  const { roomId, requestId } = req.params;
  const { action } = req.body || {};

  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Bad action' });
  }

  if (!req.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const admin = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  const request = db.prepare(`
    SELECT jr.*, r.title as room_title, r.admin_user_id,
           u.tg_id as applicant_tg_id, u.name as applicant_name, u.username as applicant_username
    FROM join_requests jr
    JOIN rooms r ON r.id = jr.room_id
    JOIN users u ON u.id = jr.user_id
    WHERE jr.id = ? AND jr.room_id = ?
  `).get(requestId, roomId);

  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.admin_user_id !== admin.id) return res.status(403).json({ error: 'Forbidden' });
  if (request.status !== 'pending') return res.status(409).json({ error: 'Already processed' });

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

/**
 * Предполагается, что у вас есть миддлварь авторизации,
 * которая из x-telegram-init-data выставляет req.user (id, tg_id).
 * Пример: app.use(authFromTelegramInitData());
 */

router.get('/api/rooms/:roomId', (req, res) => {
  const roomId = Number(req.params.roomId);
  if (!roomId) return res.status(400).json({ error: 'Bad roomId' });
  if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });

  // Комната
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  // Участники
  const members = db.prepare(`
    SELECT u.tg_id, u.name, u.username, rm.role
    FROM room_members rm
    JOIN users u ON u.id = rm.user_id
    WHERE rm.room_id = ?
    ORDER BY (rm.role = 'admin') DESC, u.name ASC
  `).all(roomId);

  // Текущий пользователь — админ?
  const isAdmin = !!db.prepare(
    'SELECT 1 FROM rooms WHERE id = ? AND admin_user_id = ?'
  ).get(roomId, req.user.id);

  // Заявки (только для админа)
  const requests = isAdmin
    ? db.prepare(`
        SELECT jr.id, jr.status, jr.created_at,
               u.tg_id, u.name, u.username
        FROM join_requests jr
        JOIN users u ON u.id = jr.user_id
        WHERE jr.room_id = ?
        ORDER BY jr.created_at ASC
      `).all(roomId)
    : [];

  // ВАЖНО: myRequest — статус заявки текущего пользователя в эту комнату
  const myReq = db.prepare(
    'SELECT status FROM join_requests WHERE room_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1'
  ).get(roomId, req.user.id) || null;

  return res.json({
    room,
    members,
    isAdmin,
    requests,
    myRequest: myReq // <- вот это и нужно фронту
  });
});



module.exports = router;