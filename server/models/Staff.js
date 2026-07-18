const {
  assertBulkAuthorityFieldsAreMutable,
  assertInstanceAuthorityFieldsAreMutable,
} = require('../src/tenant-enforcement/immutable-authority');

module.exports = (sequelize, DataTypes) => {
  const Staff = sequelize.define('Staff', {
    organizationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    role: {
      type: DataTypes.STRING,
      allowNull: false, // Должность: 'Администратор', 'Тренер', 'Оператор'
    },
    phone: {
      type: DataTypes.STRING,
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive', 'archived'),
      defaultValue: 'active',
    },
  }, {
    hooks: {
      beforeBulkUpdate(options) {
        assertBulkAuthorityFieldsAreMutable(
          options,
          ['organizationId'],
          'Staff tenant attribution is immutable',
        );
      },
      beforeUpdate(staff) {
        assertInstanceAuthorityFieldsAreMutable(
          staff,
          ['organizationId'],
          'Staff tenant attribution is immutable',
        );
      },
    },
  });

  Staff.associate = (models) => {
    Staff.belongsTo(models.Organization, { foreignKey: 'organizationId' });
    Staff.hasOne(models.Account, { foreignKey: 'staffId' });
    Staff.hasOne(models.Membership, { foreignKey: 'staffId' });
    Staff.hasMany(models.Shift, { foreignKey: 'staffId' });
  };

  return Staff;
};
