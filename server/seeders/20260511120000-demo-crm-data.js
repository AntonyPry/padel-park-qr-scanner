'use strict';

const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto
    .pbkdf2Sync(password, salt, 120000, 32, 'sha256')
    .toString('base64url');

  return `pbkdf2$120000$${salt}$${hash}`;
}

function dateAt(day, hour, minute = 0) {
  return new Date(`2026-05-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+03:00`);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();
    const passwordHash = hashPassword('Demo1234!');

    await queryInterface.sequelize.query(
      'DELETE FROM ReceiptItems WHERE receiptId BETWEEN 20000 AND 29999',
    );
    await queryInterface.sequelize.query(
      'DELETE FROM Receipts WHERE id BETWEEN 20000 AND 29999',
    );
    await queryInterface.sequelize.query(
      'DELETE FROM Visits WHERE userId IN (SELECT id FROM Users WHERE phone LIKE "+7909%")',
    );
    await queryInterface.bulkDelete('Users', {
      phone: { [Sequelize.Op.like]: '+7909%' },
    });
    await queryInterface.bulkDelete('Shifts', {
      comment: { [Sequelize.Op.like]: '[demo]%' },
    });
    await queryInterface.bulkDelete('Accounts', {
      email: { [Sequelize.Op.like]: '%@padelpark.demo' },
    });
    await queryInterface.bulkDelete('Staffs', {
      phone: { [Sequelize.Op.like]: '+790000001%' },
    });
    await queryInterface.bulkDelete('Finances', {
      comment: { [Sequelize.Op.like]: '[demo]%' },
    });
    await queryInterface.bulkDelete('Utilizations', {
      date: { [Sequelize.Op.between]: ['2026-05-01', '2026-05-14'] },
    });

    await queryInterface.bulkInsert(
      'Categories',
      [
        ['Аренда кортов', 'income', 'REVENUE_POS', 0, true],
        ['Бар / Кафе', 'income', 'REVENUE_POS', 0, true],
        ['Магазин (Товары)', 'income', 'REVENUE_POS', 0, true],
        ['Прокат инвентаря / VIP', 'income', 'REVENUE_POS', 0, true],
        ['Доп. услуги', 'income', 'REVENUE_POS', 0, true],
        ['Корпоративные мероприятия', 'income', 'REVENUE_EXT', 3, false],
        ['Закупка бара', 'expense', 'COGS', 0, false],
        ['Маркетинг', 'expense', 'OPEX', 0, false],
        ['Аренда помещения', 'expense', 'OPEX', 0, false],
      ].map(([name, type, group, commissionPercent, isSystem]) => ({
        name,
        type,
        group,
        commissionPercent,
        isSystem,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })),
      { ignoreDuplicates: true },
    );

    await queryInterface.bulkInsert(
      'CatalogRules',
      [
        ['Аренда корта 90 минут', 'Аренда кортов'],
        ['Аренда корта 60 минут', 'Аренда кортов'],
        ['Групповая тренировка', 'Аренда кортов'],
        ['Вода 0.5', 'Бар / Кафе'],
        ['Капучино', 'Бар / Кафе'],
        ['Батончик протеиновый', 'Бар / Кафе'],
        ['Мячи Head Pro', 'Магазин (Товары)'],
        ['Овергрип Wilson', 'Магазин (Товары)'],
        ['VIP раздевалка', 'Прокат инвентаря / VIP'],
        ['VIP Ракетка Шефа', 'Прокат инвентаря / VIP'],
        ['Ракетка шефа', 'Прокат инвентаря / VIP'],
        ['Тубус мячей', 'Доп. услуги'],
      ].map(([itemName, category]) => ({
        itemName,
        category,
        createdAt: now,
        updatedAt: now,
      })),
      { ignoreDuplicates: true },
    );

    await queryInterface.bulkInsert('Staffs', [
      {
        name: 'Антон Pry',
        role: 'Владелец',
        phone: '+79000000100',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        name: 'Мария Орлова',
        role: 'Управляющий',
        phone: '+79000000101',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        name: 'Илья Смирнов',
        role: 'Администратор',
        phone: '+79000000102',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        name: 'Софья Ким',
        role: 'Администратор',
        phone: '+79000000103',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        name: 'Елена Морозова',
        role: 'Бухгалтер',
        phone: '+79000000104',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const [staffRows] = await queryInterface.sequelize.query(
      'SELECT id, phone FROM Staffs WHERE phone LIKE "+790000001%"',
    );
    const staffByPhone = Object.fromEntries(
      staffRows.map((staff) => [staff.phone, staff.id]),
    );

    await queryInterface.bulkInsert('Accounts', [
      {
        staffId: staffByPhone['+79000000100'],
        email: 'owner@padelpark.demo',
        passwordHash,
        role: 'owner',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        staffId: staffByPhone['+79000000101'],
        email: 'manager@padelpark.demo',
        passwordHash,
        role: 'manager',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        staffId: staffByPhone['+79000000102'],
        email: 'admin@padelpark.demo',
        passwordHash,
        role: 'admin',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        staffId: staffByPhone['+79000000104'],
        email: 'accountant@padelpark.demo',
        passwordHash,
        role: 'accountant',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const demoUsers = [
      ['demo-tg-1', 'Алексей Новиков', '+79090000001', 'Telegram бот'],
      ['demo-tg-2', 'Кирилл Волков', '+79090000002', 'VK реклама'],
      ['demo-tg-3', 'Даниил Соколов', '+79090000003', 'Рекомендация друга'],
      ['demo-tg-4', 'Полина Сергеева', '+79090000004', '2ГИС'],
      ['demo-tg-5', 'Ирина Павлова', '+79090000005', 'Яндекс Карты'],
      ['demo-tg-6', 'Максим Фомин', '+79090000006', 'Instagram'],
      ['demo-tg-7', 'Алина Захарова', '+79090000007', 'Турнир'],
      ['demo-tg-8', 'Роман Егоров', '+79090000008', 'Ресепшн'],
    ];

    await queryInterface.bulkInsert(
      'Users',
      demoUsers.map(([telegramId, name, phone, source]) => ({
        telegramId,
        name,
        phone,
        source,
        createdAt: now,
        updatedAt: now,
      })),
    );

    const [users] = await queryInterface.sequelize.query(
      'SELECT id, phone FROM Users WHERE phone LIKE "+7909%"',
    );

    const visitCategories = [
      'Игра 2х2',
      'Групповая тренировка',
      'Индивидуальная тренировка',
      'Турнир',
      'Первый раз',
    ];
    const visits = [];

    users.forEach((user, index) => {
      for (let i = 0; i < 3; i += 1) {
        visits.push({
          userId: user.id,
          scannedAt: dateAt(1 + index + i * 3, 10 + ((index + i) % 9), 20),
          keyNumber: String(20 + index + i),
          category: visitCategories[(index + i) % visitCategories.length],
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    await queryInterface.bulkInsert('Visits', visits);

    const items = [
      ['Аренда корта 90 минут', 5850, 'SERVICE'],
      ['Аренда корта 60 минут', 3900, 'SERVICE'],
      ['Вода 0.5', 180, 'COMMODITY'],
      ['Капучино', 280, 'COMMODITY'],
      ['Батончик протеиновый', 240, 'COMMODITY'],
      ['Мячи Head Pro', 1450, 'COMMODITY'],
      ['Овергрип Wilson', 450, 'COMMODITY'],
      ['VIP раздевалка', 1200, 'SERVICE'],
      ['VIP Ракетка Шефа', 1500, 'SERVICE'],
      ['Тубус мячей', 850, 'COMMODITY'],
    ];
    const receipts = [];
    const receiptItems = [];
    let receiptId = 20000;

    for (let day = 1; day <= 11; day += 1) {
      for (let receiptIndex = 0; receiptIndex < 4; receiptIndex += 1) {
        const id = receiptId;
        receiptId += 1;
        const date = dateAt(day, 9 + receiptIndex * 3, 10);
        const selected = [
          items[(day + receiptIndex) % items.length],
          items[(day + receiptIndex + 3) % items.length],
        ];
        let total = 0;

        selected.forEach(([name, price, itemType], itemIndex) => {
          const quantity = itemIndex === 0 ? 1 : 1 + ((day + receiptIndex) % 2);
          const sum = Number(price) * quantity;
          total += sum;
          receiptItems.push({
            receiptId: id,
            name,
            quantity,
            price,
            sum,
            itemType,
            measureName: 'шт',
            costPrice: Number(price) * 0.35,
            sumPrice: sum,
            tax: 0,
            taxPercent: 0,
            discount: 0,
            createdAt: date,
            updatedAt: date,
          });
        });

        const isCash = receiptIndex === 3;
        receipts.push({
          id,
          evotorId: `demo-padel-${id}`,
          dateTime: date,
          type: 'SELL',
          totalAmount: total,
          cash: isCash ? total : 0,
          cashless: isCash ? 0 : total,
          employeeId: receiptIndex % 2 === 0 ? 'ilya-demo' : 'sofia-demo',
          shiftId: `demo-shift-${day}`,
          totalTax: 0,
          totalDiscount: 0,
          paymentSource: isCash ? 'CASH' : 'PAY_CARD',
          createdAt: date,
          updatedAt: date,
        });
      }
    }

    await queryInterface.bulkInsert('Receipts', receipts);
    await queryInterface.bulkInsert('ReceiptItems', receiptItems);

    const shifts = [];
    for (let day = 1; day <= 11; day += 1) {
      const staffId =
        day % 2 === 0
          ? staffByPhone['+79000000102']
          : staffByPhone['+79000000103'];
      shifts.push({
        date: `2026-05-${String(day).padStart(2, '0')}`,
        adminName: day % 2 === 0 ? 'Илья Смирнов' : 'Софья Ким',
        staffId,
        hours: day % 5 === 0 ? 13 : 12,
        actualHours: day % 5 === 0 ? 13 : 12,
        status: 'closed',
        manualAdjustment: day === 7 ? 500 : 0,
        comment: '[demo] Реалистичная смена для проверки мотивации',
        createdAt: now,
        updatedAt: now,
      });
    }
    await queryInterface.bulkInsert('Shifts', shifts);

    await queryInterface.bulkInsert('Finances', [
      {
        date: '2026-05-03',
        category: 'Корпоративные мероприятия',
        amount: 45000,
        type: 'income',
        comment: '[demo] Корпоративная бронь на 3 корта',
        createdAt: now,
        updatedAt: now,
      },
      {
        date: '2026-05-04',
        category: 'Закупка бара',
        amount: 18500,
        type: 'expense',
        comment: '[demo] Вода, снеки, кофе',
        createdAt: now,
        updatedAt: now,
      },
      {
        date: '2026-05-06',
        category: 'Маркетинг',
        amount: 12000,
        type: 'expense',
        comment: '[demo] Таргет на турнир выходного дня',
        createdAt: now,
        updatedAt: now,
      },
      {
        date: '2026-05-01',
        category: 'Аренда помещения',
        amount: 180000,
        type: 'expense',
        comment: '[demo] Ежемесячная аренда клуба',
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const utilization = [];
    for (let day = 1; day <= 11; day += 1) {
      utilization.push({
        date: `2026-05-${String(day).padStart(2, '0')}`,
        booked2: 42 + ((day * 7) % 24),
        booked1: 6 + ((day * 3) % 8),
        sessions2: 18 + ((day * 5) % 12),
        sessions1: 5 + ((day * 2) % 7),
        createdAt: now,
        updatedAt: now,
      });
    }

    await queryInterface.bulkInsert('Utilizations', utilization, {
      updateOnDuplicate: ['booked2', 'booked1', 'sessions2', 'sessions1', 'updatedAt'],
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      'DELETE FROM ReceiptItems WHERE receiptId BETWEEN 20000 AND 29999',
    );
    await queryInterface.sequelize.query(
      'DELETE FROM Receipts WHERE id BETWEEN 20000 AND 29999',
    );
    await queryInterface.sequelize.query(
      'DELETE FROM Visits WHERE userId IN (SELECT id FROM Users WHERE phone LIKE "+7909%")',
    );
    await queryInterface.bulkDelete('Users', {
      phone: { [Sequelize.Op.like]: '+7909%' },
    });
    await queryInterface.bulkDelete('Shifts', {
      comment: { [Sequelize.Op.like]: '[demo]%' },
    });
    await queryInterface.bulkDelete('Accounts', {
      email: { [Sequelize.Op.like]: '%@padelpark.demo' },
    });
    await queryInterface.bulkDelete('Staffs', {
      phone: { [Sequelize.Op.like]: '+790000001%' },
    });
    await queryInterface.bulkDelete('Finances', {
      comment: { [Sequelize.Op.like]: '[demo]%' },
    });
    await queryInterface.bulkDelete('Utilizations', {
      date: { [Sequelize.Op.between]: ['2026-05-01', '2026-05-14'] },
    });
  },
};
