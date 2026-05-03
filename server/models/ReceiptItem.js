module.exports = (sequelize, DataTypes) => {
  const ReceiptItem = sequelize.define('ReceiptItem', {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    quantity: {
      type: DataTypes.DECIMAL(10, 3),
      allowNull: false,
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    sum: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    // --- НОВЫЕ ПОЛЯ ИЗ ЭВОТОРА ---
    itemType: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    measureName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    costPrice: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
    },
    sumPrice: {
      type: DataTypes.DECIMAL(10, 2), // Итоговая сумма с учетом скидок
      defaultValue: 0,
    },
    tax: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
    },
    taxPercent: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
    },
    discount: {
      type: DataTypes.DECIMAL(10, 2), // Скидка на позицию
      defaultValue: 0,
    },
  });

  ReceiptItem.associate = (models) => {
    ReceiptItem.belongsTo(models.Receipt, { foreignKey: 'receiptId' });
  };

  return ReceiptItem;
};
