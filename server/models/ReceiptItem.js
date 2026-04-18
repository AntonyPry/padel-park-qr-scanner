module.exports = (sequelize, DataTypes) => {
  const ReceiptItem = sequelize.define('ReceiptItem', {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    quantity: {
      type: DataTypes.DECIMAL(10, 3), // 10.3 чтобы поддерживать весовые товары, если будут
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
  });

  ReceiptItem.associate = (models) => {
    // Позиция принадлежит конкретному чеку
    ReceiptItem.belongsTo(models.Receipt, { foreignKey: 'receiptId' });
  };

  return ReceiptItem;
};
