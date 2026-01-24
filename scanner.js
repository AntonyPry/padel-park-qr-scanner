const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const axios = require('axios');

// НАСТРОЙКИ
const SCANNER_PORT = 'COM5';
const SERVER_URL = 'http://localhost:3000/api/scan'; // Если сервер на том же компе

const port = new SerialPort({
  path: SCANNER_PORT,
  baudRate: 9600, // Стандарт для Netum
  autoOpen: false,
});

const parser = port.pipe(new ReadlineParser({ delimiter: '\r' }));

port.open((err) => {
  if (err) return console.log('Ошибка открытия порта:', err.message);
  console.log(`✅ Сканер подключен к ${SCANNER_PORT}. Жду QR коды...`);
});

parser.on('data', async (data) => {
  const qrCode = data.trim();
  if (!qrCode) return;

  console.log(`📡 Считано: ${qrCode}`);

  try {
    await axios.post(SERVER_URL, { qr: qrCode });
    console.log('➡️ Отправлено на сервер');
  } catch (error) {
    console.error('❌ Ошибка отправки:', error.message);
  }
});
