const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const axios = require('axios');

// Настройки
const SERVER_URL = 'http://localhost:3000/api/scan';
const TARGET_VENDOR_ID = '067b';
const TARGET_PRODUCT_ID = '2303';

async function startScanner() {
  console.log('🔍 [Scanner] Инициализация поиска устройства...');

  try {
    const ports = await SerialPort.list();

    // Ищем порт
    const scannerPortInfo = ports.find(
      (port) =>
        port.vendorId?.toLowerCase() === TARGET_VENDOR_ID &&
        port.productId?.toLowerCase() === TARGET_PRODUCT_ID
    );

    if (!scannerPortInfo) {
      console.error('⚠️ [Scanner] Сканер не найден. Проверьте USB.');
      return;
    }

    const path = scannerPortInfo.path;
    console.log(`✅ [Scanner] Обнаружен на порту: ${path}`);

    const port = new SerialPort({
      path: path,
      baudRate: 9600,
      autoOpen: false,
    });

    const parser = port.pipe(new ReadlineParser({ delimiter: '\r' }));

    port.open((err) => {
      if (err) return console.log('❌ [Scanner] Ошибка порта:', err.message);
      console.log(`🔌 [Scanner] Подключен и готов к работе!`);
    });

    port.on('close', () => {
      console.log('⚠️ [Scanner] Отключен.');
    });

    parser.on('data', async (data) => {
      const qrCode = data.trim();
      if (!qrCode) return;

      console.log(`📡 [Scanner] Считано: ${qrCode}`);

      try {
        // Отправляем сами себе на локальный сервер
        await axios.post(SERVER_URL, { qr: qrCode });
      } catch (error) {
        console.error('❌ [Scanner] Ошибка передачи данных:', error.message);
      }
    });
  } catch (err) {
    console.error('[Scanner] Критическая ошибка:', err);
  }
}

// ЭКСПОРТИРУЕМ ФУНКЦИЮ, А НЕ ЗАПУСКАЕМ ЕЁ
module.exports = startScanner;
