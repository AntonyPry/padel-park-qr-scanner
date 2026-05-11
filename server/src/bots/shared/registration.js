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

module.exports = {
  isValidWord,
  getPhoneValidationError,
  CONSENT_TEXT,
  SOURCE_ROWS,
};
