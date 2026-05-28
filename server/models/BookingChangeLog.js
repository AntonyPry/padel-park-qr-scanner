module.exports = (sequelize, DataTypes) => {
  const BookingChangeLog = sequelize.define('BookingChangeLog', {
    bookingId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    action: {
      type: DataTypes.ENUM(
        'created',
        'updated',
        'status_changed',
        'canceled',
        'rescheduled',
      ),
      allowNull: false,
    },
    fromStatus: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    toStatus: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    actorAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    snapshot: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  });

  BookingChangeLog.associate = (models) => {
    BookingChangeLog.belongsTo(models.Booking, { foreignKey: 'bookingId' });
    BookingChangeLog.belongsTo(models.Account, {
      as: 'actor',
      foreignKey: 'actorAccountId',
    });
  };

  return BookingChangeLog;
};
