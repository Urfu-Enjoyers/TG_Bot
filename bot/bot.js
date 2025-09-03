const { Telegraf, Markup } = require('telegraf');
const db = require('../server/db');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Кнопка открыть веб-приложение
bot.start((ctx) => {
  return ctx.reply(
    'Добро пожаловать в CampusLink! Открой мини-приложение:',
    Markup.inlineKeyboard([
      Markup.button.webApp('Open CampusLink', process.env.WEBAPP_URL)
    ])
  );
});

async function notifyJoinRequest({ adminTgId, requestId, applicantName, applicantUsername, roomTitle }) {
  const usernameText = applicantUsername ? ` (@${applicantUsername})` : '';
  const text = `Новая заявка в проект "${roomTitle}" от: ${applicantName}${usernameText}`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.webApp('Открыть CampusLink', process.env.WEBAPP_URL)]
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
