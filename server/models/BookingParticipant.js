module.exports = (sequelize, DataTypes) => {
  const BookingParticipant = sequelize.define('BookingParticipant', {
    bookingId: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    userId: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
  });

  BookingParticipant.associate = (models) => {
    BookingParticipant.belongsTo(models.Booking, {
      as: 'booking',
      foreignKey: 'bookingId',
    });
    BookingParticipant.belongsTo(models.User, {
      as: 'client',
      foreignKey: 'userId',
    });
  };

  return BookingParticipant;
};
