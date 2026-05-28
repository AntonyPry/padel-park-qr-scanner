module.exports = (sequelize, DataTypes) => {
  const BookingSettings = sequelize.define('BookingSettings', {
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
  });

  return BookingSettings;
};
