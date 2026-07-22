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

function ownershipLost(table, identity) {
  const error = new Error(`Bulk receipt fixture ownership lost for ${table} ${identity}`);
  error.code = 'TENANT_SEEDER_ARTIFACT_OWNERSHIP_LOST';
  return error;
}

async function assertReservedReceiptOwnership(queryInterface, receipts, receiptItems) {
  const ids = receipts.map((receipt) => receipt.id);
  const expected = new Map(receipts.map((receipt) => [Number(receipt.id), receipt]));
  const [occupied] = await queryInterface.sequelize.query(
    `SELECT id,organizationId,clubId,evotorId,type,totalAmount,cash,cashless,
            employeeId,shiftId,totalDiscount,paymentSource
       FROM Receipts WHERE id IN (:ids)`,
    { replacements: { ids } },
  );
  for (const row of occupied) {
    const fixture = expected.get(Number(row.id));
    const numericFields = [
      'organizationId', 'clubId', 'totalAmount', 'cash', 'cashless', 'totalDiscount',
    ];
    const stringFields = ['evotorId', 'type', 'employeeId', 'shiftId', 'paymentSource'];
    if (!fixture || numericFields.some((key) => Number(row[key]) !== Number(fixture[key])) ||
      stringFields.some((key) => row[key] !== fixture[key])) {
      throw ownershipLost('Receipts', row.id);
    }
  }
  const occupiedIds = occupied.map((row) => row.id);
  if (occupiedIds.length === 0) return occupiedIds;
  const [items] = await queryInterface.sequelize.query(
    `SELECT id,receiptId,name,quantity,price,sum,itemType,sumPrice,discount
       FROM ReceiptItems WHERE receiptId IN (:ids) ORDER BY receiptId,id`,
    { replacements: { ids: occupiedIds } },
  );
  const decimal = (value) => Math.round(Number(value) * 100) / 100;
  for (const receiptId of occupiedIds) {
    const actual = items.filter((item) => Number(item.receiptId) === Number(receiptId));
    const fixture = receiptItems.filter((item) => Number(item.receiptId) === Number(receiptId));
    const signature = (item) => [
      item.name, Number(item.quantity), decimal(item.price), decimal(item.sum),
      item.itemType, decimal(item.sumPrice), decimal(item.discount),
    ].join('|');
    if (actual.length !== fixture.length ||
      actual.map(signature).sort().join('\n') !== fixture.map(signature).sort().join('\n')) {
      throw ownershipLost('ReceiptItems', receiptId);
    }
  }
  return occupiedIds;
}

function buildReservedReceiptRows(tenant) {
  const receipts = [];
  const receiptItems = [];
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
  for (let index = 0; index < 100; index += 1) {
    const isPayback = index % 20 === 19;
    const multiplier = isPayback ? -1 : 1;
    const isCash = index % 5 === 4;
    const day = (index % 30) + 1;
    const hour = 8 + (index % 14);
    const date = new Date(
      `2026-05-${day.toString().padStart(2, '0')}T${hour.toString().padStart(2, '0')}:15:00Z`,
    );
    const receiptId = 10000 + index;
    let totalSum = 0;
    let totalDiscount = 0;
    for (let itemIndex = 0; itemIndex < (index % 3) + 1; itemIndex += 1) {
      const template = itemTemplates[(index + itemIndex) % itemTemplates.length];
      const quantity = 1 + ((index + itemIndex) % 2);
      const discount = (index + itemIndex) % 5 === 4 ? template.price * 0.1 : 0;
      const sum = template.price * quantity;
      const sumPrice = sum - discount * quantity;
      totalSum += sumPrice;
      totalDiscount += discount * quantity;
      receiptItems.push({
        receiptId,
        name: template.name,
        quantity: quantity * multiplier,
        price: template.price,
        sum: sumPrice * multiplier,
        itemType: template.type,
        measureName: 'шт',
        costPrice: template.price * 0.3,
        sumPrice: sumPrice * multiplier,
        tax: 0,
        taxPercent: 0,
        discount: discount * quantity * multiplier,
        createdAt: date,
        updatedAt: date,
      });
    }
    receipts.push({
      ...tenant,
      id: receiptId,
      evotorId: `evo-bulk-may-${receiptId}`,
      dateTime: date,
      type: isPayback ? 'PAYBACK' : 'SELL',
      totalAmount: totalSum * multiplier,
      cash: isCash ? totalSum * multiplier : 0,
      cashless: isCash ? 0 : totalSum * multiplier,
      employeeId: `admin-${(index % 3) + 1}`,
      shiftId: `shift-may-${day}`,
      totalTax: 0,
      totalDiscount: totalDiscount * multiplier,
      paymentSource: isCash ? 'CASH' : 'PAY_CARD',
      createdAt: date,
      updatedAt: date,
    });
  }
  return { receiptItems, receipts };
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const tenant = await resolveTenantScope(queryInterface);
    const { receiptItems, receipts } = buildReservedReceiptRows(tenant);

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

    const occupiedIds = await assertReservedReceiptOwnership(
      queryInterface,
      receipts,
      receiptItems,
    );
    if (occupiedIds.length > 0) {
      await queryInterface.bulkDelete('ReceiptItems', {
        receiptId: { [Sequelize.Op.in]: occupiedIds },
      });
      await queryInterface.bulkDelete('Receipts', {
        id: { [Sequelize.Op.in]: occupiedIds },
      });
    }

    // Отправляем всё это добро в базу двумя большими инсертами
    await queryInterface.bulkInsert('Receipts', receipts);
    await queryInterface.bulkInsert('ReceiptItems', receiptItems);
  },

  async down(queryInterface, Sequelize) {
    const tenant = await resolveTenantScope(queryInterface);
    const { receiptItems, receipts } = buildReservedReceiptRows(tenant);
    const occupiedIds = await assertReservedReceiptOwnership(
      queryInterface,
      receipts,
      receiptItems,
    );
    if (occupiedIds.length > 0) {
      await queryInterface.bulkDelete('ReceiptItems', { receiptId: { [Sequelize.Op.in]: occupiedIds } });
      await queryInterface.bulkDelete('Receipts', { id: { [Sequelize.Op.in]: occupiedIds } });
    }
  },
  _private: { assertReservedReceiptOwnership, buildReservedReceiptRows },
};
