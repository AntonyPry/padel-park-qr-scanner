module.exports = (sequelize, DataTypes) => {
  const Receipt = sequelize.define('Receipt', {
    evotorId: {
      type: DataTypes.STRING,
      unique: true, // Гарантирует, что мы не запишем один чек дважды
      allowNull: false,
    },
    dateTime: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    type: {
      type: DataTypes.STRING, // 'SELL' (продажа) или 'PAYBACK' (возврат)
      defaultValue: 'SELL',
    },
    totalAmount: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
    },
    cash: {
      type: DataTypes.DECIMAL(10, 2), // Наличные
      defaultValue: 0,
    },
    cashless: {
      type: DataTypes.DECIMAL(10, 2), // Безнал / Терминал
      defaultValue: 0,
    },
  });

  Receipt.associate = (models) => {
    // Один чек имеет много позиций
    Receipt.hasMany(models.ReceiptItem, {
      as: 'items',
      foreignKey: 'receiptId',
    });
  };

  return Receipt;
};
