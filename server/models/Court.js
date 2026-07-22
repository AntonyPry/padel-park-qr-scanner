module.exports = (sequelize, DataTypes) => {
  const Court = sequelize.define('Court', {
    organizationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    clubId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM('padel_double', 'padel_single', 'other'),
      allowNull: false,
      defaultValue: 'padel_double',
    },
    sortOrder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  }, {
    hooks: {
      beforeBulkUpdate(options) {
        const attributes = options.attributes || {};
        if (['organizationId', 'clubId'].some((field) =>
          Object.prototype.hasOwnProperty.call(attributes, field))) {
          const error = new Error('Court tenant attribution is immutable');
          error.code = 'COURT_TENANT_IMMUTABLE';
          throw error;
        }
      },
      beforeUpdate(court) {
        if (court.changed('organizationId') || court.changed('clubId')) {
          const error = new Error('Court tenant attribution is immutable');
          error.code = 'COURT_TENANT_IMMUTABLE';
          throw error;
        }
      },
    },
  });

  Court.associate = (models) => {
    Court.belongsTo(models.Organization, { foreignKey: 'organizationId' });
    Court.belongsTo(models.Club, { foreignKey: 'clubId' });
    Court.hasMany(models.Booking, { foreignKey: 'courtId' });
    Court.hasMany(models.BookingSeries, { foreignKey: 'courtId' });
    Court.hasMany(models.CourtBlock, { foreignKey: 'courtId' });
  };

  return Court;
};
