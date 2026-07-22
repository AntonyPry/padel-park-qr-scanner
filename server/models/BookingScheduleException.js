module.exports = (sequelize, DataTypes) => {
  const BookingScheduleException = sequelize.define('BookingScheduleException', {
    organizationId: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    clubId: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    date: {
      allowNull: false,
      type: DataTypes.DATEONLY,
    },
    isClosed: {
      allowNull: false,
      defaultValue: false,
      type: DataTypes.BOOLEAN,
    },
    workingHoursStart: {
      allowNull: true,
      type: DataTypes.STRING(5),
    },
    workingHoursEnd: {
      allowNull: true,
      type: DataTypes.STRING(5),
    },
    reason: {
      allowNull: true,
      type: DataTypes.STRING,
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
          throw new Error('Booking exception tenant attribution is immutable');
        }
      },
      beforeUpdate(row) {
        if (row.changed('organizationId') || row.changed('clubId')) {
          throw new Error('Booking exception tenant attribution is immutable');
        }
      },
    },
  });

  BookingScheduleException.associate = (models) => {
    BookingScheduleException.belongsTo(models.Organization, { foreignKey: 'organizationId' });
    BookingScheduleException.belongsTo(models.Club, { foreignKey: 'clubId' });
  };

  return BookingScheduleException;
};
