const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const certDir = path.join(process.cwd(), 'certificates');
if (!fs.existsSync(certDir)) fs.mkdirSync(certDir, { recursive: true });

// Шрифты с поддержкой кириллицы (положите их рядом с файлом в папке fonts)
const fontsDir = path.join(__dirname, 'fonts');
const fontRegular = path.join(fontsDir, 'DejaVuSans.ttf');       // или NotoSans-Regular.ttf
const fontBold = path.join(fontsDir, 'DejaVuSans-Bold.ttf');     // или NotoSans-Bold.ttf

function generateCertificate({ user = {}, room = {}, certificateNo }) {
  return new Promise((resolve, reject) => {
    // Проверим наличие шрифтов
    if (!fs.existsSync(fontRegular) || !fs.existsSync(fontBold)) {
      return reject(new Error(
        `Не найдены шрифты с кириллицей:
 - ${fontRegular}
 - ${fontBold}
Скачайте DejaVuSans.ttf и DejaVuSans-Bold.ttf (или NotoSans/Roboto с кириллицей) и положите их в ${fontsDir}`
      ));
    }

    const fileName = `certificate_${certificateNo}.pdf`;
    const filePath = path.join(certDir, fileName);
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    // Регистрируем шрифты
    doc.registerFont('Cyr', fontRegular);
    doc.registerFont('Cyr-Bold', fontBold);

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Фон
    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#0F1221');

    // Рамка
    doc.lineWidth(6)
      .strokeColor('#00E0A4')
      .rect(20, 20, doc.page.width - 40, doc.page.height - 40)
      .stroke();

    // Заголовок
    doc.fillColor('#00E0A4')
      .fontSize(28)
      .font('Cyr-Bold')
      .text('CampusLink — Сертификат участника', { align: 'center' });

    doc.moveDown(2);

    const userName =
      user.name ||
      user.first_name ||
      user.username ||
      (user.tg_id ? `ID ${user.tg_id}` : 'Участник');

    // Основной текст
    doc.fillColor('#FFFFFF')
      .fontSize(16)
      .font('Cyr')
      .text('Настоящим подтверждается, что', { align: 'center' })
      .moveDown(0.5)
      .font('Cyr-Bold')
      .fontSize(20)
      .text(userName, { align: 'center' })
      .moveDown(0.8)
      .font('Cyr')
      .fontSize(16)
      .text(`принял(а) участие в проекте «${room.title || 'Без названия'}»`, { align: 'center' })
      .moveDown(0.5)
      .text(`Дата выдачи: ${new Date().toLocaleDateString('ru-RU')}`, { align: 'center' });

    doc.moveDown(2);

    doc.font('Cyr')
      .fontSize(12)
      .fillColor('#7AEAD0')
      .text(`Номер сертификата: ${certificateNo}`, { align: 'center' });

    doc.end();

    stream.on('finish', () => resolve({ filePath, fileName }));
    stream.on('error', reject);
  });
}

module.exports = { generateCertificate, certDir };