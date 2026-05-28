module.exports = (sequelize, DataTypes) => {
  const Court = sequelize.define('Court', {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
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
  });

  Court.associate = (models) => {
    Court.hasMany(models.Booking, { foreignKey: 'courtId' });
    Court.hasMany(models.BookingSeries, { foreignKey: 'courtId' });
    Court.hasMany(models.CourtBlock, { foreignKey: 'courtId' });
  };

  return Court;
};
