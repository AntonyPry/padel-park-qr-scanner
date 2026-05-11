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
    staffId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    hours: {
      type: DataTypes.DECIMAL(4, 1),
      allowNull: false,
    },
    actualHours: {
      type: DataTypes.DECIMAL(4, 1),
      allowNull: true,
    },
    startedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    endedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('draft', 'active', 'closed', 'approved'),
      allowNull: false,
      defaultValue: 'closed',
    },
    approvedByAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    manualAdjustment: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0, // Ручные корректировки (штрафы или доп. премии)
    },
    comment: {
      type: DataTypes.TEXT,
    },
  });

  Shift.associate = (models) => {
    Shift.belongsTo(models.Staff, { foreignKey: 'staffId' });
    Shift.belongsTo(models.Account, {
      as: 'approvedBy',
      foreignKey: 'approvedByAccountId',
    });
  };

  return Shift;
};
