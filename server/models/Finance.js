module.exports = (sequelize, DataTypes) => {
  const Finance = sequelize.define('Finance', {
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    category: {
      type: DataTypes.STRING,
      allowNull: false, // Например: 'Аренда кортов', 'Бар', 'Зарплата', 'Налоги'
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM('income', 'expense'),
      allowNull: false,
    },
    comment: {
      type: DataTypes.TEXT,
    },
  });

  return Finance;
};
