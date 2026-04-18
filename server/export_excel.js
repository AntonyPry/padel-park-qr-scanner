const db = require('./models');
const XLSX = require('xlsx');

async function exportData() {
  try {
    console.log('⏳ Выгружаю данные...');

    // Берем все визиты, сортируем от новых к старым
    const visits = await db.Visit.findAll({
      include: [db.User],
      order: [['createdAt', 'DESC']],
    });

    // Преобразуем данные для Excel
    const data = visits.map((v) => ({
      'Дата и Время': v.createdAt.toLocaleString('ru-RU'),
      ФИО: v.User ? v.User.name : 'Удален',
      Телефон: v.User ? v.User.phone : '-',
      Источник: v.User ? v.User.source : '-',
      'Номер ключа': v.keyNumber || '-', // <--- ДОБАВИЛИ ЭТУ СТРОКУ
      'Telegram ID': v.User ? v.User.telegramId : '-',
    }));

    // Создаем книгу
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(data);

    // Настраиваем ширину колонок (стало на одну больше)
    worksheet['!cols'] = [
      { wch: 20 }, // Дата
      { wch: 30 }, // ФИО
      { wch: 15 }, // Телефон
      { wch: 15 }, // Источник
      { wch: 12 }, // Ключ (Новая колонка)
      { wch: 15 }, // ID
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Посещения');

    // Имя файла с датой
    const fileName = `visits_export_${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;
    XLSX.writeFile(workbook, fileName);

    console.log(`✅ Готово! Файл сохранен как: ${fileName}`);
  } catch (error) {
    console.error('❌ Ошибка экспорта:', error);
  } finally {
    await db.sequelize.close();
  }
}

exportData();
