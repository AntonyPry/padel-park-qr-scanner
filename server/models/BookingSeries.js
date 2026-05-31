module.exports = (sequelize, DataTypes) => {
  const BookingSeries = sequelize.define('BookingSeries', {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
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
    weekday: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    startTime: {
      type: DataTypes.STRING(5),
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
    startsOn: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    endsOn: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('active', 'archived'),
      allowNull: false,
      defaultValue: 'active',
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
      allowNull: true,
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
    lastGeneratedUntil: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    archivedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    archiveReason: {
      type: DataTypes.TEXT,
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
    isTraining: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    trainingRole: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    trainingAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  });

  BookingSeries.associate = (models) => {
    BookingSeries.belongsTo(models.Court, { foreignKey: 'courtId' });
    BookingSeries.belongsTo(models.User, { foreignKey: 'userId' });
    BookingSeries.belongsTo(models.Account, {
      as: 'createdBy',
      foreignKey: 'createdByAccountId',
    });
    BookingSeries.belongsTo(models.Account, {
      as: 'updatedBy',
      foreignKey: 'updatedByAccountId',
    });
    BookingSeries.belongsTo(models.Staff, {
      as: 'responsibleStaff',
      foreignKey: 'responsibleStaffId',
    });
    BookingSeries.hasMany(models.Booking, {
      as: 'bookings',
      foreignKey: 'bookingSeriesId',
    });
  };

  return BookingSeries;
};
