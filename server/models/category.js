module.exports = (sequelize, DataTypes) => {
  const Category = sequelize.define('Category', {
    name: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false,
    },
    type: {
      type: DataTypes.STRING, // 'income' или 'expense'
      allowNull: false,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  });

  Category.associate = (models) => {
    // В будущем тут можно связать ReceiptItem с Category напрямую
  };

  return Category;
};
