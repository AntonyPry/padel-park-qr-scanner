process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config();
const db = require('./models');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const QRCode = require('qrcode');
const { Op } = require('sequelize');
const { SocksProxyAgent } = require('socks-proxy-agent');

// --- ИМПОРТЫ TELEGRAM ---
const {
  Bot: TgBot,
  session: tgSession,
  InlineKeyboard: TgInlineKeyboard,
  Keyboard: TgKeyboard,
  InputFile: TgInputFile,
} = require('grammy');
const {
  conversations: tgConversations,
  createConversation: tgCreateConversation,
} = require('@grammyjs/conversations');
const { run: runTg } = require('@grammyjs/runner');

// --- ИМПОРТЫ VK ---
const { VK, Keyboard: VkKeyboard } = require('vk-io');
const { SessionManager: VkSessionManager } = require('@vk-io/session');
const {
  SceneManager: VkSceneManager,
  StepScene: VkStepScene,
} = require('@vk-io/scenes');

const PORT = process.env.PORT || 3000;

// ==========================================
// 1. ВЕБ-СЕРВЕР И АДМИНКА (Общая часть)
// ==========================================
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Разрешаем React-клиенту подключаться к сокетам
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.get('/api/search', async (req, res) => {
  /* Твой код поиска без изменений */
  const query = req.query.q;
  if (!query || query.length < 2) return res.json([]);
  try {
    const users = await db.User.findAll({
      where: { name: { [Op.like]: `%${query}%` } },
      limit: 5,
    });
    res.json(users);
  } catch (e) {
    res.json([]);
  }
});

app.post('/api/manual-visit', async (req, res) => {
  /* Твой код ручного визита без изменений */
  const { userId } = req.body;
  if (!userId) return res.status(400).send('No ID');
  try {
    const user = await db.User.findByPk(userId);
    if (!user) return res.status(404).send('User not found');
    const lastVisit = await db.Visit.findOne({
      where: { userId: user.id },
      order: [['createdAt', 'DESC']],
    });
    let visitId;
    let isNewVisit = true;
    if (lastVisit && (new Date() - lastVisit.createdAt) / 60000 < 5) {
      visitId = lastVisit.id;
      isNewVisit = false;
    }
    if (isNewVisit) {
      const newVisit = await db.Visit.create({ userId: user.id });
      visitId = newVisit.id;
    }
    io.emit('scan_result', {
      success: true,
      user: user,
      visitId: visitId,
      isRepeated: !isNewVisit,
    });
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).send('Error');
  }
});

app.post('/api/key', async (req, res) => {
  /* Твой код ключа без изменений */
  const { visitId, keyNumber } = req.body;
  try {
    await db.Visit.update({ keyNumber }, { where: { id: visitId } });
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).send('Error');
  }
});

app.post('/api/scan', async (req, res) => {
  let { qr } = req.body;
  console.log('📡 Сканер прислал:', JSON.stringify(qr));
  if (!qr) return res.status(400).send('No QR');

  // ЖЕСТКАЯ ОЧИСТКА: убираем ВСЕ пробелы, переносы строк и символ "@"
  qr = String(qr).replace(/[\s@\r\n]/g, '');
  console.log('🧹 После очистки ищем:', qr);

  try {
    let user;

    if (qr.startsWith('vk_')) {
      const vkId = qr.replace('vk_', '');
      user = await db.User.findOne({ where: { vkId: vkId } });
    } else if (qr.startsWith('web_')) {
      user = await db.User.findOne({ where: { webId: qr } });
    } else {
      // ИЩЕМ ПО TELEGRAM ID
      // Используем Op.or, чтобы найти ID, даже если в базе он почему-то записан с собакой
      user = await db.User.findOne({
        where: {
          [Op.or]: [{ telegramId: qr }, { telegramId: `@${qr}` }],
        },
      });
    }

    if (user) {
      console.log(`✅ Найден гость: ${user.name}`);
      const lastVisit = await db.Visit.findOne({
        where: { userId: user.id },
        order: [['createdAt', 'DESC']],
      });

      let visitId;
      let isNewVisit = true;

      if (lastVisit && (new Date() - lastVisit.createdAt) / 60000 < 5) {
        console.log('⏱️ Повторный скан (прошло менее 5 мин).');
        visitId = lastVisit.id;
        isNewVisit = false;
      }

      if (isNewVisit) {
        const newVisit = await db.Visit.create({ userId: user.id });
        visitId = newVisit.id;
      }

      io.emit('scan_result', {
        success: true,
        user: user,
        visitId: visitId,
        isRepeated: !isNewVisit,
      });
      res.json({ status: 'ok', found: true });
    } else {
      console.log(`❌ Гость с ID ${qr} НЕ НАЙДЕН в базе.`);
      io.emit('scan_result', { success: false, id: qr });
      res.json({ status: 'ok', found: false });
    }
  } catch (e) {
    console.error('Ошибка при сканировании:', e);
    res.status(500).send('Server Error');
  }
});

// === API РЕГИСТРАЦИИ (Для Веб-версии и Админа) ===
app.post('/api/register', async (req, res) => {
  const { name, phone, source } = req.body;

  if (!name || !phone) {
    return res.status(400).json({ error: 'Имя и телефон обязательны' });
  }

  try {
    const webId = 'web_' + Date.now();

    // Пишем в правильную колонку webId
    const newUser = await db.User.create({
      webId: webId,
      name: name,
      phone: phone,
      source: source || 'Ресепшн (Админ)',
    });

    res.json({
      status: 'success',
      user: newUser,
      qrData: webId,
    });
  } catch (e) {
    console.error('Ошибка веб-регистрации:', e);
    res.status(500).json({ error: 'Ошибка сервера при регистрации' });
  }
});

// --- API ПЕРСОНАЛА ---
app.get('/api/staff', async (req, res) => {
  try {
    const staff = await db.Staff.findAll({
      order: [['createdAt', 'DESC']],
    });
    res.json(staff);
  } catch (e) {
    console.error('Ошибка получения персонала:', e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// (Опционально) API для добавления сотрудника
app.post('/api/staff', async (req, res) => {
  const { name, role, phone } = req.body;
  try {
    const newStaff = await db.Staff.create({ name, role, phone });
    res.json(newStaff);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка добавления' });
  }
});

app.get('/api/visits', async (req, res) => {
  try {
    const visits = await db.Visit.findAll({
      limit: 50,
      order: [['createdAt', 'DESC']],
      include: [{ model: db.User }], // Подтягиваем данные пользователя для каждого визита
    });

    // Преобразуем формат БД в формат, который ожидает фронтенд
    const formattedVisits = visits.map((v) => ({
      id: String(v.id),
      success: true,
      time: new Date(v.createdAt).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      name: v.User?.name || 'Неизвестный',
      phone: v.User?.phone || '',
      source: v.User?.source || '-',
      visitId: v.id,
      keyNumber: v.keyNumber || '',
      keyIssued: !!v.keyNumber,
    }));

    res.json(formattedVisits);
  } catch (e) {
    console.error(e);
    res.status(500).send('Error');
  }
});

// --- ВЕБХУК ДЛЯ ЭВОТОРА ---
app.post('/api/webhooks/evotor', async (req, res) => {
  try {
    // 1. Простейшая защита (как было у заказчика)
    const secret = process.env.EVOTOR_WEBHOOK_SECRET || '';
    const token =
      req.headers['x-evotor-token'] || req.headers['authorization'] || '';

    if (secret && token.replace(/^Bearer\s+/i, '').trim() !== secret) {
      return res.status(401).send('Unauthorized');
    }

    // Эвотор иногда присылает чек внутри поля "data"
    const payload = req.body;
    const receiptData =
      payload.data && payload.type?.toLowerCase().includes('receipt')
        ? payload.data
        : payload;

    // Уникальный ID чека
    const evotorId = String(
      receiptData.id || receiptData.receiptId || receiptData.uuid || Date.now(),
    );

    // Проверяем, не сохраняли ли мы уже этот чек
    const existing = await db.Receipt.findOne({ where: { evotorId } });
    if (existing) {
      return res.status(200).send('Already processed');
    }

    // 2. Считаем суммы оплат (наличные и безнал)
    let cash = 0;
    let cashless = 0;

    // Если это возврат ('PAYBACK'), суммы должны быть с минусом
    const isPayback = receiptData.type === 'PAYBACK';
    const multiplier = isPayback ? -1 : 1;

    if (Array.isArray(receiptData.payments)) {
      receiptData.payments.forEach((p) => {
        const amt = (Number(p.amount) || 0) * multiplier;
        if (p.type === 'cash') cash += amt;
        if (p.type === 'cashless') cashless += amt;
      });
    }

    // 3. Сохраняем чек в базу
    const newReceipt = await db.Receipt.create({
      evotorId,
      dateTime: receiptData.dateTime || receiptData.closeDate || new Date(),
      type: receiptData.type || 'SELL',
      totalAmount: cash + cashless,
      cash,
      cashless,
    });

    // 4. Сохраняем позиции внутри чека (товары)
    const positions = receiptData.positions || receiptData.items || [];
    const itemsToInsert = positions.map((pos) => ({
      receiptId: newReceipt.id,
      name: pos.name || 'Неизвестный товар',
      quantity: Number(pos.quantity) || 1,
      price: Number(pos.price) || 0,
      sum:
        (Number(pos.resultPrice || pos.sum || pos.quantity * pos.price) || 0) *
        multiplier,
    }));

    if (itemsToInsert.length > 0) {
      await db.ReceiptItem.bulkCreate(itemsToInsert);
    }

    console.log(
      `✅ Сохранен чек Эвотор: ${evotorId} на сумму ${newReceipt.totalAmount} ₽`,
    );
    res.status(200).send('OK');
  } catch (error) {
    console.error('Ошибка вебхука Эвотор:', error);
    res.status(500).send('Server Error');
  }
});

// --- УМНЫЙ КАТЕГОРИЗАТОР (БАЗА + ХАРДКОД) ---
async function getCategory(itemName, dbRules) {
  const name = String(itemName).toLowerCase().trim();

  // 1. Сначала проверяем точное совпадение из базы данных (CatalogRules)
  if (dbRules[name]) {
    return dbRules[name];
  }

  // 2. Если в базе нет, используем старую логику поиска по ключевым словам (Fallback)
  if (
    [
      'bombbar',
      'shock',
      'вода',
      'чиа',
      'cola',
      'кофе',
      'чай',
      'смузи',
      'батончик',
    ].some((kw) => name.includes(kw))
  )
    return 'Бар / Кафе';
  if (
    ['овергрип', 'намотка', 'мяч', 'купить ракетку'].some((kw) =>
      name.includes(kw),
    )
  )
    return 'Магазин (Товары)';
  if (
    ['вип', 'vip', 'ракетка шефа', 'тубус', 'аренда ракетки', 'люкс'].some(
      (kw) => name.includes(kw),
    )
  )
    return 'Прокат инвентаря / VIP';
  if (name.includes('турнир')) return 'Турниры';

  return 'Аренда кортов'; // По умолчанию
}

app.get('/api/finance', async (req, res) => {
  try {
    const records = [];

    const rulesList = await db.CatalogRule.findAll();
    const rulesMap = {};
    rulesList.forEach((r) => {
      rulesMap[r.itemName.toLowerCase()] = r.category;
    });

    const manualFinances = await db.Finance.findAll().catch(() => []);
    manualFinances.forEach((f) => {
      records.push({
        id: `manual-${f.id}`,
        date: f.date,
        category: f.category,
        amount: f.amount,
        type: f.type,
        comment: f.comment || 'Ручная операция',
        source: 'manual',
      });
      if (f.type === 'income' && f.category === 'lunda_courts') {
        records.push({
          id: `fee-lun-${f.id}`,
          date: f.date,
          category: 'Комиссия Лунда',
          amount: (Number(f.amount) * 0.015).toString(),
          type: 'expense',
          comment: `1.5% с Лунды`,
          source: 'fee',
        });
      }
      if (f.type === 'income' && f.category === 'aladdin') {
        records.push({
          id: `fee-ala-${f.id}`,
          date: f.date,
          category: 'Комиссия Алладин',
          amount: (Number(f.amount) * 0.17).toString(),
          type: 'expense',
          comment: `17% с Алладин`,
          source: 'fee',
        });
      }
    });

    const receipts = await db.Receipt.findAll();
    const items = await db.ReceiptItem.findAll();
    const salesByDate = {}; // Для расчета ЗП

    for (const receipt of receipts) {
      const receiptItems = items.filter((i) => i.receiptId === receipt.id);
      const dateStr = new Date(receipt.dateTime).toISOString().split('T')[0];
      const isPayback = receipt.type === 'PAYBACK';
      const multiplier = isPayback ? -1 : 1;

      if (!salesByDate[dateStr])
        salesByDate[dateStr] = { revenue: 0, items: [] };

      if (Number(receipt.cashless) > 0) {
        records.push({
          id: `fee-acq-${receipt.id}`,
          date: dateStr,
          category: 'Эквайринг',
          amount: (Number(receipt.cashless) * 0.01).toString(),
          type: isPayback ? 'income' : 'expense',
          comment: `1% от безнала`,
          source: 'fee',
          rawCashless: receipt.cashless,
        });
      }

      for (const item of receiptItems) {
        const amount = Number(item.sum);
        if (amount === 0) continue;
        const category = await getCategory(item.name, rulesMap);

        salesByDate[dateStr].revenue += amount * multiplier;
        salesByDate[dateStr].items.push({
          name: item.name,
          category,
          sum: amount * multiplier,
          qty: Number(item.quantity) * multiplier,
        });

        records.push({
          id: `evotor-${item.id}`,
          date: dateStr,
          category: category,
          amount: amount.toString(),
          type: isPayback ? 'expense' : 'income',
          comment: `${item.name} (${item.quantity} шт.)`,
          source: 'evotor',
        });
      }
    }

    // --- ИНЖЕКТИРУЕМ ЗАРПЛАТЫ ИЗ СМЕН В P&L ---
    const shifts = await db.Shift.findAll();
    shifts.forEach((shift) => {
      if (!shift.adminName || !shift.hours) return; // Игнорируем черновики

      const hrs = Number(shift.hours);
      const todaySales = salesByDate[shift.date] || { revenue: 0, items: [] };

      let shiftBonus = 0;
      let foodSales = 0,
        storeSales = 0,
        vipSales = 0,
        chefSum = 0,
        chefQty = 0,
        tubesSum = 0,
        tubesQty = 0;

      todaySales.items.forEach((item) => {
        if (item.category === 'Бар / Кафе') foodSales += item.sum;
        if (
          item.category === 'Магазин (Товары)' &&
          !item.name.toLowerCase().includes('аренда')
        )
          storeSales += item.sum;
        if (
          item.category === 'Прокат инвентаря / VIP' ||
          item.category === 'Доп. услуги'
        ) {
          if (
            item.name.toLowerCase().includes('vip') ||
            item.name.toLowerCase().includes('вип')
          )
            vipSales += item.sum;
          if (item.name.toLowerCase().includes('ракетка шефа')) {
            chefSum += item.sum;
            chefQty += item.qty;
          }
          if (item.name.toLowerCase().includes('тубус')) {
            tubesSum += item.sum;
            tubesQty += item.qty;
          }
        }
      });

      if (foodSales > 4000) shiftBonus += foodSales * 0.05;
      if (storeSales > 3000) shiftBonus += storeSales * 0.03;
      if (vipSales > 0) shiftBonus += vipSales * 0.1;
      if (chefQty > 8) shiftBonus += chefSum * 0.05;
      if (tubesQty > 5) shiftBonus += tubesSum * 0.1;

      const shiftBasePay =
        Math.min(hrs, 12) * 250 + Math.max(0, hrs - 12) * 300;
      const totalPay =
        shiftBasePay + shiftBonus + (Number(shift.manualAdjustment) || 0);

      if (totalPay > 0) {
        records.push({
          id: `payroll-${shift.id}`,
          date: shift.date,
          category: 'payroll', // Системный идентификатор ЗП (OPEX)
          amount: totalPay.toString(),
          type: 'expense',
          comment: `ЗП: ${shift.adminName} (${hrs}ч)`,
          source: 'system',
        });
      }
    });

    records.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    res.json(records);
  } catch (error) {
    console.error('❌ Ошибка P&L:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

const isCategory = (itemName, keywords) =>
  keywords.some((kw) => itemName.toLowerCase().includes(kw));

app.get('/api/payroll', async (req, res) => {
  try {
    const { from, to } = req.query;
    const shiftsDb = await db.Shift.findAll();
    const receipts = await db.Receipt.findAll({
      include: [{ model: db.ReceiptItem, as: 'items' }],
    });

    // Загружаем правила категорий
    const rulesList = await db.CatalogRule.findAll();
    const rulesMap = {};
    rulesList.forEach((r) => {
      rulesMap[r.itemName.toLowerCase()] = r.category;
    });

    // 1. Группируем продажи по дням
    const salesByDate = {};
    for (const r of receipts) {
      const dStr = new Date(r.dateTime).toISOString().split('T')[0];
      if (from && dStr < from) continue;
      if (to && dStr > to) continue;

      if (!salesByDate[dStr]) salesByDate[dStr] = { revenue: 0, items: [] };

      const multiplier = r.type === 'PAYBACK' ? -1 : 1;
      for (const item of r.items) {
        const category = await getCategory(item.name, rulesMap);
        const sum = Number(item.sum) * multiplier;
        const qty = Number(item.quantity) * multiplier;
        salesByDate[dStr].revenue += sum;
        salesByDate[dStr].items.push({ name: item.name, category, sum, qty });
      }
    }

    // 2. Отбираем смены за выбранный период
    const validShifts = shiftsDb.filter((s) => {
      if (from && s.date < from) return false;
      if (to && s.date > to) return false;
      return true;
    });

    const payrollByAdmin = {};
    const shiftsHistory = [];
    const processedDates = new Set();

    // 3. Считаем зарплату по заполненным сменам
    validShifts.forEach((shift) => {
      processedDates.add(shift.date);
      const admin = shift.adminName;
      const hrs = Number(shift.hours);
      const todaySales = salesByDate[shift.date] || { revenue: 0, items: [] };

      let shiftBonus = 0;
      let foodSales = 0,
        storeSales = 0,
        vipSales = 0,
        chefSum = 0,
        chefQty = 0,
        tubesSum = 0,
        tubesQty = 0;

      // Детализация для всплывающего окна (модалки)
      const detailedItems = todaySales.items.map((item) => {
        let bucket = '';
        if (item.category === 'Бар / Кафе') {
          foodSales += item.sum;
          bucket = 'food';
        }
        if (
          item.category === 'Магазин (Товары)' &&
          !item.name.toLowerCase().includes('аренда')
        ) {
          storeSales += item.sum;
          bucket = 'store';
        }
        if (
          item.category === 'Прокат инвентаря / VIP' ||
          item.category === 'Доп. услуги'
        ) {
          if (
            item.name.toLowerCase().includes('vip') ||
            item.name.toLowerCase().includes('вип')
          ) {
            vipSales += item.sum;
            bucket = 'vip';
          }
          if (item.name.toLowerCase().includes('ракетка шефа')) {
            chefSum += item.sum;
            chefQty += item.qty;
            bucket = 'chef';
          }
          if (item.name.toLowerCase().includes('тубус')) {
            tubesSum += item.sum;
            tubesQty += item.qty;
            bucket = 'tube';
          }
        }
        return { ...item, bucket };
      });

      if (foodSales > 4000) shiftBonus += foodSales * 0.05;
      if (storeSales > 3000) shiftBonus += storeSales * 0.03; // В оригинале товары 3%
      if (vipSales > 0) shiftBonus += vipSales * 0.1;
      if (chefQty > 8) shiftBonus += chefSum * 0.05;
      if (tubesQty > 5) shiftBonus += tubesSum * 0.1;

      const shiftBasePay =
        Math.min(hrs, 12) * 250 + Math.max(0, hrs - 12) * 300;
      const manualAdj = Number(shift.manualAdjustment) || 0;
      const totalPay = shiftBasePay + shiftBonus + manualAdj;

      if (admin) {
        if (!payrollByAdmin[admin])
          payrollByAdmin[admin] = {
            name: admin,
            totalShifts: 0,
            totalHours: 0,
            basePay: 0,
            bonusPay: 0,
            totalPay: 0,
          };
        payrollByAdmin[admin].totalShifts += 1;
        payrollByAdmin[admin].totalHours += hrs;
        payrollByAdmin[admin].basePay += shiftBasePay;
        payrollByAdmin[admin].bonusPay += shiftBonus + manualAdj;
        payrollByAdmin[admin].totalPay += totalPay;
      }

      shiftsHistory.push({
        id: shift.id,
        isDraft: false,
        date: shift.date,
        adminName: admin,
        hours: hrs,
        dailyRevenue: todaySales.revenue,
        basePay: shiftBasePay,
        bonus: shiftBonus + manualAdj,
        total: totalPay,
        items: detailedItems,
      });
    });

    // 4. Генерируем "Черновики" для дней, когда касса есть, а админа нет
    Object.keys(salesByDate).forEach((date) => {
      if (!processedDates.has(date)) {
        const todaySales = salesByDate[date];
        const detailedItems = todaySales.items.map((item) => {
          let bucket = '';
          if (item.category === 'Бар / Кафе') bucket = 'food';
          if (item.category === 'Магазин (Товары)') bucket = 'store';
          if (item.name.toLowerCase().includes('vip')) bucket = 'vip';
          if (item.name.toLowerCase().includes('ракетка шефа')) bucket = 'chef';
          if (item.name.toLowerCase().includes('тубус')) bucket = 'tube';
          return { ...item, bucket };
        });

        shiftsHistory.push({
          id: `draft-${date}`,
          isDraft: true,
          date: date,
          adminName: null,
          hours: 0,
          dailyRevenue: todaySales.revenue,
          basePay: 0,
          bonus: 0,
          total: 0,
          items: detailedItems,
        });
      }
    });

    shiftsHistory.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    res.json({ admins: Object.values(payrollByAdmin), shifts: shiftsHistory });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/shifts', async (req, res) => {
  try {
    const { date, adminName, hours, manualAdjustment, comment } = req.body;
    const newShift = await db.Shift.create({
      date,
      adminName,
      hours,
      manualAdjustment,
      comment,
    });
    res.json(newShift);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка добавления смены' });
  }
});

// --- АНАЛИТИКА ПОСЕЩЕНИЙ С ФИЛЬТРОМ ПО ДАТАМ ---
app.get('/api/analytics/visits', async (req, res) => {
  try {
    const { from, to } = req.query;
    const whereClause = {};

    // Фильтр по датам
    if (from || to) {
      whereClause.createdAt = {};
      if (from) whereClause.createdAt[Op.gte] = new Date(from);
      // Если есть дата 'to', берем ее до конца дня (23:59:59)
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        whereClause.createdAt[Op.lte] = toDate;
      }
    }

    const visits = await db.Visit.findAll({
      where: whereClause,
      include: [{ model: db.User }],
    });

    const totalVisits = visits.length;
    const uniqueUsers = new Set();
    const sourcesMap = {};
    const topGuestsMap = {};
    const heatMapMap = {};

    visits.forEach((v) => {
      const user = v.User || {
        name: 'Неизвестный',
        phone: '',
        source: 'Не указан',
      };
      uniqueUsers.add(user.id || v.userId);

      const source = user.source || 'Не указан';
      sourcesMap[source] = (sourcesMap[source] || 0) + 1;

      if (!topGuestsMap[user.name]) {
        topGuestsMap[user.name] = {
          name: user.name,
          phone: user.phone,
          visits: 0,
        };
      }
      topGuestsMap[user.name].visits++;

      const d = new Date(v.createdAt);
      let day = d.getDay();
      day = day === 0 ? 7 : day;
      const hour = d.getHours();
      const heatKey = `${day}-${hour}`;
      heatMapMap[heatKey] = (heatMapMap[heatKey] || 0) + 1;
    });

    const sources = Object.keys(sourcesMap)
      .map((k) => ({ name: k, value: sourcesMap[k] }))
      .sort((a, b) => b.value - a.value);

    const topGuests = Object.values(topGuestsMap)
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 10);

    res.json({
      totalVisits,
      uniqueGuests: uniqueUsers.size,
      sources,
      topGuests,
      heatMap: heatMapMap,
    });
  } catch (error) {
    console.error('Ошибка аналитики визитов:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/utilization', async (req, res) => {
  try {
    const data = await db.Utilizations.findAll({ order: [['date', 'ASC']] });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/utilization', async (req, res) => {
  try {
    // Поддерживаем как одиночные запросы (объект), так и массовые (массив)
    const recordsToProcess = Array.isArray(req.body) ? req.body : [req.body];

    const results = await Promise.all(
      recordsToProcess.map(async (item) => {
        const { date, booked1, booked2, sessions1, sessions2 } = item;

        const [record] = await db.Utilizations.upsert({
          date,
          booked1: Number(booked1) || 0,
          booked2: Number(booked2) || 0,
          sessions1: Number(sessions1) || 0,
          sessions2: Number(sessions2) || 0,
        });
        return record;
      }),
    );

    res.json({ success: true, records: results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- API СПРАВОЧНИКА ТОВАРОВ ---

app.get('/api/catalog/unmapped', async (req, res) => {
  try {
    // 1. Получаем все существующие правила
    const rules = await db.CatalogRule.findAll();
    const mappedNames = new Set(rules.map((r) => r.itemName.toLowerCase()));

    // 2. Получаем ВСЕ уникальные товары из чеков
    const items = await db.ReceiptItem.findAll({
      attributes: ['name'],
      group: ['name'],
    });

    const unmapped = [];
    const legacyHardcode = [
      'bombbar',
      'shock',
      'вода',
      'чиа',
      'cola',
      'кофе',
      'чай',
      'смузи',
      'батончик',
      'овергрип',
      'намотка',
      'мяч',
      'купить ракетку',
      'вип',
      'vip',
      'ракетка шефа',
      'тубус',
      'аренда ракетки',
      'люкс',
      'турнир',
    ];

    items.forEach((item) => {
      const name = item.name.toLowerCase();
      // Если товара нет в базе правил...
      if (!mappedNames.has(name)) {
        // ...и мы хотим предложить его распределить (игнорируем старый хардкод, чтобы он не вылез весь сразу, хотя можно убрать проверку legacyHardcode)
        if (!legacyHardcode.some((kw) => name.includes(kw))) {
          unmapped.push(item.name);
        }
      }
    });

    res.json(unmapped);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/catalog/rules', async (req, res) => {
  try {
    const rules = await db.CatalogRule.findAll({
      order: [['createdAt', 'DESC']],
    });
    res.json(rules);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/catalog/rules', async (req, res) => {
  try {
    const { itemName, category } = req.body;
    await db.CatalogRule.upsert({ itemName, category });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сохранения' });
  }
});

app.delete('/api/catalog/rules/:id', async (req, res) => {
  try {
    await db.CatalogRule.destroy({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

// ==========================================
// 2. ОБЩИЕ ФУНКЦИИ И ТЕКСТЫ
// ==========================================
function isValidWord(text) {
  return text && /^[а-яА-Яa-zA-ZёЁ\-]+$/.test(text.trim());
}
function getPhoneValidationError(text) {
  if (!text) return 'Пустой ввод.';
  if (!/^[0-9\+\-\s\(\)]+$/.test(text)) return '❌ Используйте только цифры.';
  const digitsOnly = text.replace(/\D/g, '');
  if (digitsOnly.length < 10) return '❌ Слишком короткий номер.';
  if (digitsOnly.length > 15) return '❌ Слишком длинный номер.';
  return null;
}

const CONSENT_TEXT = `Просим вас ознакомиться с правилами клуба и дать согласие ☺️\n
• Публичная оферта и правила клуба\nhttps://padelpark.pro/rules\n
• Политика конфиденциальности\nhttps://padelpark.pro/privacy\n
• Согласие на получение рекламных рассылок\nhttps://padelpark.pro/adv\n
Нажмите на пункты ниже, чтобы отметить их галочками.`;

// ==========================================
// 3. БОТ ВКОНТАКТЕ (VK-IO)
// ==========================================
const vk = new VK({ token: process.env.VK_TOKEN });
const vkSessionManager = new VkSessionManager();
const vkSceneManager = new VkSceneManager();

vk.updates.on('message_new', vkSessionManager.middleware);
vk.updates.on('message_new', vkSceneManager.middleware);
vk.updates.on('message_new', vkSceneManager.middlewareIntercept);

// Главное меню ВК
const vkMainMenu = VkKeyboard.builder()
  .textButton({
    label: '🔄 Сгенерировать QR заново',
    payload: { command: 'get_qr' },
    color: VkKeyboard.PRIMARY_COLOR,
  })
  .row()
  .textButton({
    label: '✏️ Изменить данные',
    payload: { command: 'edit_profile' },
    color: VkKeyboard.SECONDARY_COLOR,
  });

// Клавиатура галочек для ВК
function getVkConsentKeyboard(consents) {
  const kb = VkKeyboard.builder()
    .textButton({
      label: consents[0]
        ? '✅ С правилами ознакомлен'
        : '❌ С правилами ознакомлен',
      payload: { consent: 0 },
    })
    .row()
    .textButton({
      label: consents[1]
        ? '✅ Согласен с политикой'
        : '❌ Согласен с политикой',
      payload: { consent: 1 },
    })
    .row()
    .textButton({
      label: consents[2] ? '✅ Даю согласие' : '❌ Даю согласие',
      payload: { consent: 2 },
    })
    .row();
  if (consents.every((c) => c === true)) {
    kb.textButton({
      label: '➡️ ДАЛЕЕ',
      payload: { command: 'start_register' },
      color: VkKeyboard.POSITIVE_COLOR,
    });
  }
  return kb.inline();
}

// Сцена регистрации ВК
const vkRegisterScene = new VkStepScene('register', [
  async (ctx) => {
    if (ctx.scene.step.firstTime) {
      await ctx.send('📝 Шаг 1 из 4. Введите ваше Имя:');
      return;
    }
    if (!isValidWord(ctx.text)) {
      await ctx.send('❌ Имя должно состоять только из букв.');
      return;
    }
    ctx.scene.state.firstname = ctx.text.trim();
    await ctx.scene.step.next();
  },
  async (ctx) => {
    if (ctx.scene.step.firstTime) {
      await ctx.send('📝 Шаг 2 из 4. Введите вашу Фамилию:');
      return;
    }
    if (!isValidWord(ctx.text)) {
      await ctx.send('❌ Фамилия должна состоять только из букв.');
      return;
    }
    ctx.scene.state.surname = ctx.text.trim();
    await ctx.scene.step.next();
  },
  async (ctx) => {
    if (ctx.scene.step.firstTime) {
      await ctx.send(
        `👤 ${ctx.scene.state.firstname} ${ctx.scene.state.surname}\n\nШаг 3 из 4. Введите ваш номер телефона.\nПример: +79991234567`,
      );
      return;
    }
    const error = getPhoneValidationError(ctx.text);
    if (error) {
      await ctx.send(error);
      return;
    }
    ctx.scene.state.phone = ctx.text.trim();
    await ctx.scene.step.next();
  },
  async (ctx) => {
    if (ctx.scene.step.firstTime) {
      const kb = VkKeyboard.builder()
        .textButton({ label: 'Вк' })
        .textButton({ label: 'Тг' })
        .textButton({ label: 'Радио' })
        .row()
        .textButton({ label: 'Хоккей' })
        .textButton({ label: 'Сайт' })
        .textButton({ label: 'Инст' })
        .row()
        .textButton({ label: 'Рекомендация друзей' })
        .textButton({ label: 'Увидел в тц' })
        .row()
        .textButton({ label: 'Другое' })
        .oneTime();
      await ctx.send('📊 Шаг 4 из 4. Откуда вы о нас узнали?', {
        keyboard: kb,
      });
      return;
    }
    ctx.scene.state.source = ctx.text.trim();

    // Сохранение в БД
    const vkId = String(ctx.peerId);
    const fullName = `${ctx.scene.state.surname} ${ctx.scene.state.firstname}`;

    try {
      await db.User.upsert({
        vkId: vkId,
        name: fullName,
        phone: ctx.scene.state.phone,
        source: ctx.scene.state.source,
      });
      await ctx.send('✅ Регистрация завершена!');
      await sendVkQrCode(ctx, vkId);
    } catch (e) {
      console.error('Ошибка БД ВК:', e);
      await ctx.send('❌ Произошла ошибка при сохранении.');
    }

    await ctx.scene.leave();
  },
]);
vkSceneManager.addScenes([vkRegisterScene]);

// Обработчик сообщений ВК (Защита от случайных сообщений - админ может чатиться)
vk.updates.on('message_new', async (ctx, next) => {
  // Если клиент уже в процессе регистрации - пропускаем его к сцене
  if (ctx.scene.current) return next();

  // Если это просто текст без кнопок/команд (живое общение) - ИГНОРИРУЕМ
  if (
    !ctx.messagePayload &&
    !['Начать', 'начать', '/start'].includes(ctx.text)
  ) {
    return;
  }

  const payload = ctx.messagePayload || {};
  const vkId = String(ctx.peerId);

  // Команда старта
  if (['Начать', 'начать', '/start'].includes(ctx.text)) {
    const user = await db.User.findOne({ where: { vkId } });
    if (user) {
      return ctx.send(`С возвращением, ${user.name}!`, {
        keyboard: vkMainMenu,
      });
    }
    ctx.session.consents = [false, false, false];
    return ctx.send(CONSENT_TEXT, {
      keyboard: getVkConsentKeyboard(ctx.session.consents),
      dont_parse_links: true,
    });
  }

  // Обработка галочек согласия
  if (payload.consent !== undefined) {
    ctx.session.consents[payload.consent] =
      !ctx.session.consents[payload.consent];
    return ctx.send('Обновил выбор:', {
      keyboard: getVkConsentKeyboard(ctx.session.consents),
    });
  }

  // Кнопка Далее
  if (payload.command === 'start_register') {
    await ctx.send('✅ Согласия получены. Начинаем...');
    return ctx.scene.enter('register');
  }

  // Главное меню
  if (payload.command === 'get_qr' || ctx.text === '🔄 Сгенерировать QR заново')
    return sendVkQrCode(ctx, vkId);
  if (payload.command === 'edit_profile' || ctx.text === '✏️ Изменить данные')
    return ctx.scene.enter('register');

  await next();
});

async function sendVkQrCode(ctx, vkId) {
  try {
    const qrBuffer = await QRCode.toBuffer(`vk_${vkId}`, {
      scale: 10,
      margin: 1,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
    // В ВК картинку нужно сначала загрузить на сервер
    const attachment = await vk.upload.messagePhoto({
      source: { value: qrBuffer, filename: 'qr.png' },
      peer_id: ctx.peerId,
    });
    await ctx.send({
      message: 'Ваш пропуск:',
      attachment,
      keyboard: vkMainMenu,
    });
  } catch (e) {
    console.error('Ошибка QR ВК:', e);
    ctx.send('Ошибка генерации QR.');
  }
}

// ==========================================
// 4. БОТ TELEGRAM (GRAMMY)
// ==========================================

// Передаем настройки игнорирования сертификатов (для разных версий библиотеки)
const agent = new SocksProxyAgent(process.env.TG_PROXY_CREDS, {
  rejectUnauthorized: false, // Для старых версий socks-proxy-agent
  tls: { rejectUnauthorized: false }, // Для новых версий (v8+)
});

const tgBot = new TgBot(process.env.BOT_TOKEN, {
  client: {
    buildFetchConfig: (init) => ({
      ...init,
      agent: agent,
    }),
  },
});
tgBot.use(tgSession({ initial: () => ({ consents: [false, false, false] }) }));
tgBot.use(tgConversations());

const tgMainMenu = new TgKeyboard()
  .text('🔄 Сгенерировать QR заново')
  .row()
  .text('✏️ Изменить данные')
  .resized();

function getTgConsentKeyboard(consents) {
  const kb = new TgInlineKeyboard();
  kb.text(
    consents[0] ? '✅ С правилами ознакомлен' : '❌ С правилами ознакомлен',
    'toggle_consent_0',
  ).row();
  kb.text(
    consents[1] ? '✅ Согласен с политикой' : '❌ Согласен с политикой',
    'toggle_consent_1',
  ).row();
  kb.text(
    consents[2] ? '✅ Даю согласие' : '❌ Даю согласие',
    'toggle_consent_2',
  ).row();
  if (consents.every((c) => c === true)) kb.text('➡️ ДАЛЕЕ', 'consent_next');
  else kb.text('🔒 Отметьте все пункты выше', 'consent_locked');
  return kb;
}

async function tgRegisterConversation(conversation, ctx) {
  let surname, firstname, phone, source;
  let step = 0;
  while (step < 4) {
    if (step === 0) {
      await ctx.reply('📝 Шаг 1 из 4. Введите ваше **Имя**:', {
        parse_mode: 'Markdown',
        reply_markup: { remove_keyboard: true },
      });
      const msg = await conversation.waitFor(':text');
      if (!isValidWord(msg.message.text)) {
        await ctx.reply('❌ Имя должно состоять только из букв.');
        continue;
      }
      firstname = msg.message.text.trim();
      step++;
    } else if (step === 1) {
      const kb = new TgKeyboard().text('⬅️ Назад').resized().oneTime();
      await ctx.reply('📝 Шаг 2 из 4. Введите вашу **Фамилию**:', {
        parse_mode: 'Markdown',
        reply_markup: kb,
      });
      const msg = await conversation.waitFor(':text');
      if (msg.message.text === '⬅️ Назад') {
        step--;
        continue;
      }
      if (!isValidWord(msg.message.text)) {
        await ctx.reply('❌ Фамилия должна состоять только из букв.');
        continue;
      }
      surname = msg.message.text.trim();
      step++;
    } else if (step === 2) {
      const kb = new TgKeyboard().text('⬅️ Назад').resized().oneTime();
      await ctx.reply(
        `👤 ${firstname} ${surname}\n\nШаг 3 из 4. Введите ваш **номер телефона**.\nПример: +79991234567`,
        { parse_mode: 'Markdown', reply_markup: kb },
      );
      const msg = await conversation.waitFor(':text');
      if (msg.message.text === '⬅️ Назад') {
        step--;
        continue;
      }
      const error = getPhoneValidationError(msg.message.text);
      if (error) {
        await ctx.reply(error);
        continue;
      }
      phone = msg.message.text.trim();
      step++;
    } else if (step === 3) {
      const sources = [
        ['Вк', 'Тг', 'Радио'],
        ['Хоккей', 'Сайт', 'Инст'],
        ['Рекомендация друзей', 'Увидел в тц'],
        ['Другое', '⬅️ Назад'],
      ];
      const kb = TgKeyboard.from(sources).resized().oneTime();
      await ctx.reply('📊 Шаг 4 из 4. Откуда вы о нас узнали?', {
        reply_markup: kb,
      });
      const msg = await conversation.waitFor(':text');
      if (msg.message.text === '⬅️ Назад') {
        step--;
        continue;
      }
      source = msg.message.text.trim();
      step++;
    }
  }
  const telegramId = String(ctx.from.id);
  const fullName = `${surname} ${firstname}`;
  await conversation.external(async () => {
    await db.User.upsert({
      telegramId: telegramId,
      name: fullName,
      phone: phone,
      source: source,
    });
  });
  await ctx.reply(`✅ Регистрация завершена!`, {
    reply_markup: { remove_keyboard: true },
  });
  await ctx.reply('Ваш пропуск:');
  return sendTgQrCode(ctx, telegramId);
}
tgBot.use(tgCreateConversation(tgRegisterConversation, 'register'));

tgBot.command('start', async (ctx) => {
  const telegramId = String(ctx.from.id);
  const user = await db.User.findOne({ where: { telegramId } });
  if (user)
    return ctx.reply(`С возвращением, ${user.name}!`, {
      reply_markup: tgMainMenu,
    });
  ctx.session.consents = [false, false, false];
  await ctx.reply(CONSENT_TEXT, {
    link_preview_options: { is_disabled: true },
    reply_markup: getTgConsentKeyboard(ctx.session.consents),
  });
});

tgBot.callbackQuery(/toggle_consent_(\d)/, async (ctx) => {
  const idx = parseInt(ctx.match[1]);
  ctx.session.consents[idx] = !ctx.session.consents[idx];
  try {
    await ctx.editMessageReplyMarkup({
      reply_markup: getTgConsentKeyboard(ctx.session.consents),
    });
  } catch (e) {}
  await ctx.answerCallbackQuery();
});
tgBot.callbackQuery('consent_locked', async (ctx) => {
  await ctx.answerCallbackQuery({
    text: 'Отметьте все пункты галочками!',
    show_alert: true,
  });
});
tgBot.callbackQuery('consent_next', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText('✅ Согласия получены. Начинаем регистрацию...');
  await ctx.conversation.enter('register');
});

tgBot.hears(
  '🔄 Сгенерировать QR заново',
  async (ctx) => await sendTgQrCode(ctx, String(ctx.from.id)),
);
tgBot.hears(
  '✏️ Изменить данные',
  async (ctx) => await ctx.conversation.enter('register'),
);

async function sendTgQrCode(ctx, tgId) {
  try {
    const qrBuffer = await QRCode.toBuffer(tgId, { scale: 10, margin: 1 });
    await ctx.replyWithPhoto(new TgInputFile(qrBuffer), {
      reply_markup: tgMainMenu,
    });
  } catch (error) {
    console.error(error);
    ctx.reply('Ошибка генерации QR.');
  }
}

// ==========================================
// 5. ЗАПУСК ВСЕЙ СИСТЕМЫ
// ==========================================
async function startApp() {
  try {
    await db.sequelize.authenticate();
    console.log('✅ БД подключена.');

    runTg(tgBot);
    console.log('✈️ Telegram Бот запущен.');

    await vk.updates.start();
    console.log('🟦 ВКонтакте Бот запущен.');

    // Запуск Веб-сервера
    server.listen(PORT);
  } catch (error) {
    console.error('❌ Ошибка старта:', error);
  }
}

startApp();
