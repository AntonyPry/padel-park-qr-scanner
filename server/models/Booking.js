module.exports = (sequelize, DataTypes) => {
  const Booking = sequelize.define('Booking', {
    courtId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    clientName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    clientPhone: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    startsAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    endsAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    durationMinutes: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    bookingType: {
      type: DataTypes.ENUM(
        'game',
        'tournament',
        'personal_training',
        'master_class',
        'group_training',
        'corporate',
      ),
      allowNull: false,
      defaultValue: 'game',
    },
    responsibleStaffId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('new', 'confirmed', 'canceled', 'arrived', 'no_show'),
      allowNull: false,
      defaultValue: 'new',
    },
    paymentStatus: {
      type: DataTypes.ENUM('unpaid', 'partial', 'paid', 'refunded'),
      allowNull: false,
      defaultValue: 'unpaid',
    },
    paymentMethod: {
      type: DataTypes.ENUM('unknown', 'cash', 'cashless', 'mixed'),
      allowNull: false,
      defaultValue: 'unknown',
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    },
    paidAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    },
    source: {
      type: DataTypes.ENUM('phone', 'admin', 'walk_in', 'other'),
      allowNull: false,
      defaultValue: 'phone',
    },
    comment: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    cancellationReason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    canceledAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    createdByAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    updatedByAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    bookingSeriesId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  });

  Booking.associate = (models) => {
    Booking.belongsTo(models.Court, { foreignKey: 'courtId' });
    Booking.belongsTo(models.User, { foreignKey: 'userId' });
    Booking.belongsTo(models.Account, {
      as: 'createdBy',
      foreignKey: 'createdByAccountId',
    });
    Booking.belongsTo(models.Account, {
      as: 'updatedBy',
      foreignKey: 'updatedByAccountId',
    });
    Booking.belongsTo(models.BookingSeries, {
      as: 'series',
      foreignKey: 'bookingSeriesId',
    });
    Booking.belongsTo(models.Staff, {
      as: 'responsibleStaff',
      foreignKey: 'responsibleStaffId',
    });
    Booking.hasMany(models.BookingChangeLog, {
      as: 'changeLogs',
      foreignKey: 'bookingId',
    });
  };

  return Booking;
};
