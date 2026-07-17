module.exports = (sequelize, DataTypes) => {
  const BookingPriceRule = sequelize.define('BookingPriceRule', {
    organizationId: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    clubId: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
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
  }, {
    hooks: {
      beforeBulkUpdate(options) {
        const attributes = options.attributes || {};
        if (['organizationId', 'clubId'].some((field) =>
          Object.prototype.hasOwnProperty.call(attributes, field))) {
          throw new Error('Booking price rule tenant attribution is immutable');
        }
      },
      beforeUpdate(row) {
        if (row.changed('organizationId') || row.changed('clubId')) {
          throw new Error('Booking price rule tenant attribution is immutable');
        }
      },
    },
  });

  BookingPriceRule.associate = (models) => {
    BookingPriceRule.belongsTo(models.Organization, { foreignKey: 'organizationId' });
    BookingPriceRule.belongsTo(models.Club, { foreignKey: 'clubId' });
  };

  return BookingPriceRule;
};
