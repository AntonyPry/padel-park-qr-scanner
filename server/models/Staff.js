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
  });

  Staff.associate = (models) => {
    Staff.belongsTo(models.Organization, { foreignKey: 'organizationId' });
    Staff.hasOne(models.Account, { foreignKey: 'staffId' });
    Staff.hasOne(models.Membership, { foreignKey: 'staffId' });
    Staff.hasMany(models.Shift, { foreignKey: 'staffId' });
  };

  return Staff;
};
