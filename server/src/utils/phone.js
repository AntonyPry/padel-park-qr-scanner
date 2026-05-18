const db = require('../../models');

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function getPhoneLookupDigits(phone) {
  const digits = normalizePhone(phone);
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function formatRussianPhone(phone) {
  const localDigits = getPhoneLookupDigits(phone);
  if (localDigits.length !== 10) return String(phone || '').trim();

  return `+7 (${localDigits.slice(0, 3)}) ${localDigits.slice(3, 6)}-${localDigits.slice(6, 8)}-${localDigits.slice(8, 10)}`;
}

function normalizedPhoneColumn(columnName = 'phone') {
  const { col, fn } = db.Sequelize;

  return fn(
    'REPLACE',
    fn(
      'REPLACE',
      fn(
        'REPLACE',
        fn('REPLACE', fn('REPLACE', col(columnName), '+', ''), ' ', ''),
        '(',
        '',
      ),
      ')',
      '',
    ),
    '-',
    '',
  );
}

module.exports = {
  formatRussianPhone,
  getPhoneLookupDigits,
  normalizePhone,
  normalizedPhoneColumn,
};
