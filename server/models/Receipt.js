module.exports = (sequelize, DataTypes) => {
  const Receipt = sequelize.define('Receipt', {
    evotorId: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false,
    },
    dateTime: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    type: {
      type: DataTypes.STRING, // 'SELL' или 'PAYBACK'
      defaultValue: 'SELL',
    },
    totalAmount: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
    },
    cash: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
    },
    cashless: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
    },
    // --- НОВЫЕ ПОЛЯ ИЗ ЭВОТОРА ---
    employeeId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    shiftId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    totalTax: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
    },
    totalDiscount: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
    },
    paymentSource: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  });

  Receipt.associate = (models) => {
    Receipt.hasMany(models.ReceiptItem, {
      as: 'items',
      foreignKey: 'receiptId',
    });
  };

  return Receipt;
};
