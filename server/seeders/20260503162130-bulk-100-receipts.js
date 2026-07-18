'use strict';

const crypto = require('crypto');
const {
  DEFAULT_CLUB_SLUG,
  DEFAULT_ORGANIZATION_SLUG,
} = require('../src/tenant-foundation/constants');

async function resolveTenantScope(queryInterface) {
  const columns = await queryInterface.describeTable('Receipts');
  if (!columns.organizationId || !columns.clubId) return {};
  const [rows] = await queryInterface.sequelize.query(
    `SELECT o.id organizationId,c.id clubId
       FROM Organizations o JOIN Clubs c ON c.organizationId=o.id
      WHERE o.slug=:organizationSlug AND c.slug=:clubSlug
        AND o.status='active' AND c.status='active'`,
    {
      replacements: {
        clubSlug: DEFAULT_CLUB_SLUG,
        organizationSlug: DEFAULT_ORGANIZATION_SLUG,
      },
    },
  );
  const [[counts]] = await queryInterface.sequelize.query(
    'SELECT (SELECT COUNT(*) FROM Organizations) organizations,(SELECT COUNT(*) FROM Clubs) clubs',
  );
  if (rows.length !== 1 || Number(counts.organizations) !== 1 || Number(counts.clubs) !== 1) {
    const error = new Error('Bulk receipt fixture requires the exact default tenant');
    error.code = 'TENANT_SEEDER_DEFAULT_ONLY';
    throw error;
  }
  return rows[0];
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const tenant = await resolveTenantScope(queryInterface);
    const receipts = [];
    const receiptItems = [];

    // Шаблоны товаров для реалистичности
    const itemTemplates = [
      { name: 'Аренда корта (1 час)', price: 3900, type: 'SERVICE' },
      { name: 'Аренда корта (1.5 часа)', price: 5850, type: 'SERVICE' },
      { name: 'Аренда ракетки', price: 450, type: 'SERVICE' },
      { name: 'Вода 0.5 б/г', price: 150, type: 'COMMODITY' },
      { name: 'Кофе Капучино', price: 250, type: 'COMMODITY' },
      { name: 'Мяч теннисный (банка)', price: 1200, type: 'COMMODITY' },
      { name: 'Взнос за турнир MIX', price: 4500, type: 'SERVICE' },
      { name: 'VIP Ракетка Шефа', price: 1500, type: 'SERVICE' },
      { name: 'Овергрип Wilson', price: 350, type: 'COMMODITY' },
    ];

    let receiptIdCounter = 10000; // Начинаем с 10000, чтобы не задеть твои реальные данные

    // Генерируем 100 чеков
    for (let i = 0; i < 100; i++) {
      const isPayback = Math.random() > 0.95; // 5% вероятности, что это возврат
      const multiplier = isPayback ? -1 : 1;
      const isCash = Math.random() > 0.8; // 20% оплат наличными

      // Раскидываем даты случайно по маю
      const day = Math.floor(Math.random() * 30) + 1;
      const hour = Math.floor(Math.random() * 14) + 8; // С 8 утра до 22 вечера
      const date = new Date(
        `2026-05-${day.toString().padStart(2, '0')}T${hour.toString().padStart(2, '0')}:15:00Z`,
      );

      const itemCount = Math.floor(Math.random() * 3) + 1; // От 1 до 3 позиций в чеке
      let totalSum = 0;
      let totalDiscount = 0;

      const currentReceiptId = receiptIdCounter++;

      // Генерируем позиции для текущего чека
      for (let j = 0; j < itemCount; j++) {
        const template =
          itemTemplates[Math.floor(Math.random() * itemTemplates.length)];
        const qty = Math.floor(Math.random() * 2) + 1; // 1 или 2 штуки

        // 20% шанс на скидку в 10%
        const hasDiscount = Math.random() > 0.8;
        const discount = hasDiscount ? template.price * 0.1 : 0;

        const sum = template.price * qty;
        const sumPrice = sum - discount * qty;

        totalSum += sumPrice;
        totalDiscount += discount * qty;

        receiptItems.push({
          receiptId: currentReceiptId,
          name: template.name,
          quantity: qty * multiplier,
          price: template.price,
          sum: sumPrice * multiplier, // Тут уже правильная сумма со скидкой
          itemType: template.type,
          measureName: 'шт',
          costPrice: template.price * 0.3, // Условная себестоимость 30%
          sumPrice: sumPrice * multiplier,
          tax: 0,
          taxPercent: 0,
          discount: discount * qty * multiplier,
          createdAt: date,
          updatedAt: date,
        });
      }

      // Сохраняем заголовок чека
      receipts.push({
        ...tenant,
        id: currentReceiptId,
        evotorId: `evo-bulk-may-${currentReceiptId}`,
        dateTime: date,
        type: isPayback ? 'PAYBACK' : 'SELL',
        totalAmount: totalSum * multiplier,
        cash: isCash ? totalSum * multiplier : 0,
        cashless: !isCash ? totalSum * multiplier : 0,
        employeeId: `admin-${Math.floor(Math.random() * 3) + 1}`,
        shiftId: `shift-may-${day}`,
        totalTax: 0,
        totalDiscount: totalDiscount * multiplier,
        paymentSource: isCash ? 'CASH' : 'PAY_CARD',
        createdAt: date,
        updatedAt: date,
      });
    }

    if (tenant.organizationId) {
      const columns = await queryInterface.describeTable('Receipts');
      if (columns.idempotencyKey) {
        receipts.forEach((receipt) => {
          receipt.idempotencyKey = crypto.createHash('sha256')
            .update(`fixture|${tenant.organizationId}|${tenant.clubId}|${receipt.evotorId}`)
            .digest('hex');
        });
      }
    }

    // Отправляем всё это добро в базу двумя большими инсертами
    await queryInterface.bulkInsert('Receipts', receipts);
    await queryInterface.bulkInsert('ReceiptItems', receiptItems);
  },

  async down(queryInterface, Sequelize) {
    const tenant = await resolveTenantScope(queryInterface);
    // Команда для отката: удалит только эти 100 тестовых чеков
    await queryInterface.sequelize.query(
      `DELETE FROM ReceiptItems WHERE receiptId IN (
         SELECT id FROM Receipts WHERE id BETWEEN 10000 AND 10099
         ${tenant.organizationId ? 'AND organizationId=:organizationId AND clubId=:clubId' : ''}
       )`,
      { replacements: tenant },
    );
    await queryInterface.bulkDelete(
      'Receipts',
      {
        ...tenant,
        id: { [Sequelize.Op.between]: [10000, 10099] },
      },
      {},
    );
  },
};
