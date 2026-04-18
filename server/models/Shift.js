module.exports = (sequelize, DataTypes) => {
  const Shift = sequelize.define('Shift', {
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    adminName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    hours: {
      type: DataTypes.DECIMAL(4, 1),
      allowNull: false,
    },
    manualAdjustment: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0, // Ручные корректировки (штрафы или доп. премии)
    },
    comment: {
      type: DataTypes.TEXT,
    },
  });

  return Shift;
};
