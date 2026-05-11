module.exports = (sequelize, DataTypes) => {
  const MotivationRule = sequelize.define('MotivationRule', {
    key: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    label: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    group: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'general',
    },
    unit: {
      type: DataTypes.ENUM('currency', 'percent', 'quantity', 'hours'),
      allowNull: false,
      defaultValue: 'currency',
    },
    value: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    },
    sortOrder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  });

  return MotivationRule;
};
