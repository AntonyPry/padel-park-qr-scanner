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
    await queryInterface.addColumn('Users', 'phoneNormalized', {
      type: Sequelize.STRING(32),
      allowNull: true,
    });

    await queryInterface.addColumn('Users', 'note', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    await queryInterface.addColumn('Users', 'status', {
      type: Sequelize.ENUM('active', 'merged', 'archived'),
      allowNull: false,
      defaultValue: 'active',
    });

    await queryInterface.addColumn('Users', 'mergedIntoUserId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'Users',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    await queryInterface.addColumn('Users', 'mergedAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.addColumn('Users', 'mergedByAccountId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'Accounts',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    const users = await queryInterface.sequelize.query(
      'SELECT id, phone FROM Users WHERE phone IS NOT NULL',
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

    await queryInterface.addIndex('Users', ['phoneNormalized'], {
      name: 'users_phone_normalized_idx',
    });
    await queryInterface.addIndex('Users', ['status'], {
      name: 'users_status_idx',
    });
    await queryInterface.addIndex('Users', ['source'], {
      name: 'users_source_idx',
    });
    await queryInterface.addIndex('Users', ['mergedIntoUserId'], {
      name: 'users_merged_into_user_id_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('Users', 'users_merged_into_user_id_idx');
    await queryInterface.removeIndex('Users', 'users_source_idx');
    await queryInterface.removeIndex('Users', 'users_status_idx');
    await queryInterface.removeIndex('Users', 'users_phone_normalized_idx');

    await queryInterface.removeColumn('Users', 'mergedByAccountId');
    await queryInterface.removeColumn('Users', 'mergedAt');
    await queryInterface.removeColumn('Users', 'mergedIntoUserId');
    await queryInterface.removeColumn('Users', 'status');
    await queryInterface.removeColumn('Users', 'note');
    await queryInterface.removeColumn('Users', 'phoneNormalized');

    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_Users_status";',
      );
    }
  },
};
