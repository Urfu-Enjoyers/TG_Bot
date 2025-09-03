const { Telegraf, Markup } = require('telegraf');
const db = require('../server/db');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Кнопка открыть веб-приложение
bot.start((ctx) => {
  return ctx.reply(
    'Добро пожаловать в ProjectHub! Открой мини-приложение:',
    Markup.inlineKeyboard([
      Markup.button.webApp('Open ProjectHub', process.env.WEBAPP_URL)
    ])
  );
});

// Обработка approve/reject для заявок через callback_data
bot.on('callback_query', async (ctx) => {
  try {
    const data = ctx.callbackQuery.data || '';
    // Формат: jr:<requestId>:approve|reject
    if (!data.startsWith('jr:')) return ctx.answerCbQuery();
    const [_, reqId, action] = data.split(':');
    const request = db.prepare(`
      SELECT jr.*, r.title as room_title, r.admin_user_id, u.tg_id as applicant_tg_id
      FROM join_requests jr
      JOIN rooms r ON r.id = jr.room_id
      JOIN users u ON u.id = jr.user_id
      WHERE jr.id = ?
    `).get(reqId);
    if (!request) {
      await ctx.answerCbQuery('Заявка не найдена', { show_alert: true });
      return;
    }

    // Проверка: этот пользователь — админ комнаты?
    const admin = db.prepare('SELECT * FROM users WHERE tg_id = ?').get(ctx.from.id.toString());
    if (!admin || admin.id !== request.admin_user_id) {
      await ctx.answerCbQuery('Недостаточно прав', { show_alert: true });
      return;
    }

    if (request.status !== 'pending') {
      await ctx.answerCbQuery('Заявка уже обработана', { show_alert: true });
      return;
    }

    const now = new Date().toISOString();
    if (action === 'approve') {
      const upd = db.prepare('UPDATE join_requests SET status = ?, updated_at = ? WHERE id = ?');
      upd.run('approved', now, reqId);
      db.prepare('INSERT OR IGNORE INTO room_members(room_id, user_id, role) VALUES(?,?,?)')
        .run(request.room_id, request.user_id, 'member');
      await ctx.answerCbQuery('Одобрено ✅');
      await ctx.editMessageReplyMarkup(undefined);
      try {
        await bot.telegram.sendMessage(request.applicant_tg_id, `Ваша заявка одобрена в проект "${request.room_title}"!`);
      } catch {}
    } else {
      const upd = db.prepare('UPDATE join_requests SET status = ?, updated_at = ? WHERE id = ?');
      upd.run('rejected', now, reqId);
      await ctx.answerCbQuery('Отклонено ❌');
      await ctx.editMessageReplyMarkup(undefined);
      try {
        await bot.telegram.sendMessage(request.applicant_tg_id, `К сожалению, заявка в "${request.room_title}" отклонена.`);
      } catch {}
    }
  } catch (e) {
    console.error('callback_query error', e);
    try { await ctx.answerCbQuery('Ошибка'); } catch {}
  }
});

async function notifyJoinRequest({ adminTgId, requestId, applicantName, roomTitle }) {
  const text = `Новая заявка в проект "${roomTitle}" от: ${applicantName}`;
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Одобрить', `jr:${requestId}:approve`),
      Markup.button.callback('❌ Отклонить', `jr:${requestId}:reject`)
    ],
    [Markup.button.webApp('Открыть ProjectHub', process.env.WEBAPP_URL)]
  ]);
  try {
    await bot.telegram.sendMessage(adminTgId, text, keyboard);
  } catch (e) {
    console.error('notifyJoinRequest error:', e.message);
  }
}

function launchBot() {
  bot.launch().then(() => {
    console.log('Telegram Bot started');
  }).catch((e) => {
    console.error('Bot launch error:', e);
  });

  // Для корректного завершения
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

module.exports = { bot, launchBot, notifyJoinRequest };