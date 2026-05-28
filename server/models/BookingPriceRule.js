module.exports = (sequelize, DataTypes) => {
  const BookingPriceRule = sequelize.define('BookingPriceRule', {
    name: {
      allowNull: false,
      type: DataTypes.STRING,
    },
    courtType: {
      allowNull: false,
      defaultValue: 'all',
      type: DataTypes.ENUM('all', 'padel_double', 'padel_single', 'other'),
    },
    weekdays: {
      allowNull: false,
      type: DataTypes.JSON,
    },
    startTime: {
      allowNull: false,
      defaultValue: '08:00',
      type: DataTypes.STRING(5),
    },
    endTime: {
      allowNull: false,
      defaultValue: '24:00',
      type: DataTypes.STRING(5),
    },
    pricePerHour: {
      allowNull: false,
      defaultValue: 0,
      type: DataTypes.DECIMAL(10, 2),
    },
    priority: {
      allowNull: false,
      defaultValue: 100,
      type: DataTypes.INTEGER,
    },
    status: {
      allowNull: false,
      defaultValue: 'active',
      type: DataTypes.ENUM('active', 'archived'),
    },
  });

  return BookingPriceRule;
};
