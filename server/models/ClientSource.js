module.exports = (sequelize, DataTypes) => {
  const ClientSource = sequelize.define('ClientSource', {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    status: {
      type: DataTypes.ENUM('active', 'archived'),
      allowNull: false,
      defaultValue: 'active',
    },
    sortOrder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  });

  ClientSource.associate = (models) => {
    ClientSource.hasMany(models.User, {
      foreignKey: 'sourceId',
    });
  };

  return ClientSource;
};
