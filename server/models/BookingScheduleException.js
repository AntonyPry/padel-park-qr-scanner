module.exports = (sequelize, DataTypes) => {
  const BookingScheduleException = sequelize.define('BookingScheduleException', {
    date: {
      allowNull: false,
      type: DataTypes.DATEONLY,
      unique: true,
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
  });

  return BookingScheduleException;
};
