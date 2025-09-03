const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const certDir = path.join(process.cwd(), 'certificates');
if (!fs.existsSync(certDir)) fs.mkdirSync(certDir);

function generateCertificate({ user, room, certificateNo }) {
  return new Promise((resolve, reject) => {
    const fileName = `certificate_${certificateNo}.pdf`;
    const filePath = path.join(certDir, fileName);
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Фон
    doc.rect(0, 0, doc.page.width, doc.page.height)
      .fill('#0F1221');

    // Рамка
    doc.lineWidth(6)
      .strokeColor('#00E0A4')
      .rect(20, 20, doc.page.width - 40, doc.page.height - 40)
      .stroke();

    // Заголовок
    doc.fillColor('#00E0A4')
      .fontSize(28)
      .font('Helvetica-Bold')
      .text('ProjectHub — Сертификат Участника', { align: 'center', underline: false });

    doc.moveDown(2);

    // Основной текст
    doc.fillColor('#FFFFFF')
      .fontSize(16)
      .font('Helvetica')
      .text(`Настоящим подтверждается, что`, { align: 'center' })
      .moveDown(0.5)
      .font('Helvetica-Bold')
      .fontSize(20)
      .fillColor('#FFFFFF')
      .text(`${user.name || user.first_name || user.username || ('ID ' + user.tg_id)}`, { align: 'center' })
      .moveDown(0.8)
      .font('Helvetica')
      .fontSize(16)
      .fillColor('#FFFFFF')
      .text(`принял(а) участие в проекте "${room.title}"`, { align: 'center' })
      .moveDown(0.5)
      .text(`Дата выдачи: ${new Date().toLocaleDateString()}`, { align: 'center' });

    doc.moveDown(2);

    doc.font('Helvetica')
      .fontSize(12)
      .fillColor('#7AEAD0')
      .text(`Номер сертификата: ${certificateNo}`, { align: 'center' });

    doc.end();

    stream.on('finish', () => resolve({ filePath, fileName }));
    stream.on('error', reject);
  });
}

module.exports = { generateCertificate, certDir };