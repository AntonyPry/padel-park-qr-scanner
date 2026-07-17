module.exports = (sequelize, DataTypes) => {
  const BookingSettings = sequelize.define('BookingSettings', {
    organizationId: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    clubId: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    workingHoursStart: {
      allowNull: false,
      defaultValue: '08:00',
      type: DataTypes.STRING(5),
    },
    workingHoursEnd: {
      allowNull: false,
      defaultValue: '24:00',
      type: DataTypes.STRING(5),
    },
    slotStepMinutes: {
      allowNull: false,
      defaultValue: 30,
      type: DataTypes.INTEGER,
    },
    minDurationMinutes: {
      allowNull: false,
      defaultValue: 60,
      type: DataTypes.INTEGER,
    },
    maxDurationMinutes: {
      allowNull: false,
      defaultValue: 240,
      type: DataTypes.INTEGER,
    },
    cancellationDeadlineHours: {
      allowNull: false,
      defaultValue: 0,
      type: DataTypes.INTEGER,
    },
    rescheduleDeadlineHours: {
      allowNull: false,
      defaultValue: 0,
      type: DataTypes.INTEGER,
    },
  }, {
    hooks: {
      beforeBulkUpdate(options) {
        const attributes = options.attributes || {};
        if (['organizationId', 'clubId'].some((field) =>
          Object.prototype.hasOwnProperty.call(attributes, field))) {
          throw new Error('Booking settings tenant attribution is immutable');
        }
      },
      beforeUpdate(row) {
        if (row.changed('organizationId') || row.changed('clubId')) {
          throw new Error('Booking settings tenant attribution is immutable');
        }
      },
    },
  });

  BookingSettings.associate = (models) => {
    BookingSettings.belongsTo(models.Organization, { foreignKey: 'organizationId' });
    BookingSettings.belongsTo(models.Club, { foreignKey: 'clubId' });
  };

  return BookingSettings;
};
