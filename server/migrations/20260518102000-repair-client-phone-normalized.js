'use strict';

function getPhoneLookupDigits(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function formatRussianPhone(phone) {
  const localDigits = getPhoneLookupDigits(phone);
  if (localDigits.length !== 10) return String(phone || '').trim();

  return `+7 (${localDigits.slice(0, 3)}) ${localDigits.slice(3, 6)}-${localDigits.slice(6, 8)}-${localDigits.slice(8, 10)}`;
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const users = await queryInterface.sequelize.query(
      'SELECT id, phone FROM Users',
      { type: Sequelize.QueryTypes.SELECT },
    );

    await Promise.all(
      users.map((user) => {
        const phoneNormalized = getPhoneLookupDigits(user.phone);
        return queryInterface.bulkUpdate(
          'Users',
          {
            phone: formatRussianPhone(user.phone),
            phoneNormalized: phoneNormalized.length === 10 ? phoneNormalized : null,
          },
          { id: user.id },
        );
      }),
    );
  },

  async down() {},
};
