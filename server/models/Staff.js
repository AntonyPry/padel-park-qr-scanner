module.exports = (sequelize, DataTypes) => {
  const Staff = sequelize.define('Staff', {
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
    Staff.hasOne(models.Account, { foreignKey: 'staffId' });
    Staff.hasMany(models.Shift, { foreignKey: 'staffId' });
  };

  return Staff;
};
