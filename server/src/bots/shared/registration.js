const {
  resolveClientAccessContext,
} = require('../../services/client-access-context.service');

function isValidWord(text) {
  return text && /^[а-яА-Яa-zA-ZёЁ-]+$/.test(text.trim());
}

function getPhoneValidationError(text) {
  if (!text) return 'Пустой ввод.';
  if (!/^[0-9+\s()-]+$/.test(text)) return '❌ Используйте только цифры.';

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

const SOURCE_ROWS = [
  ['Вк', 'Тг', 'Радио'],
  ['Хоккей', 'Сайт', 'Инст'],
  ['Рекомендация друзей', 'Увидел в тц'],
  ['Другое'],
];

function chunkRows(items, size = 3) {
  const rows = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

async function getSourceRows(db, tenant = null) {
  try {
    const context = await resolveClientAccessContext(tenant);
    const sources = await db.ClientSource.findAll({
      where: {
        ...(context.scoped ? { organizationId: context.organizationId } : {}),
        status: 'active',
      },
      order: [
        ['sortOrder', 'ASC'],
        ['name', 'ASC'],
      ],
      raw: true,
    });
    const names = sources.map((source) => source.name).filter(Boolean);
    return names.length > 0 ? chunkRows(names) : SOURCE_ROWS;
  } catch {
    return SOURCE_ROWS;
  }
}

module.exports = {
  isValidWord,
  getPhoneValidationError,
  CONSENT_TEXT,
  SOURCE_ROWS,
  getSourceRows,
};
