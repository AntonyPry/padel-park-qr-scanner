module.exports = (sequelize, DataTypes) => {
  const ClientSavedView = sequelize.define('ClientSavedView', {
    accountId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    filters: {
      type: DataTypes.JSON,
      allowNull: false,
    },
  });

  ClientSavedView.associate = (models) => {
    ClientSavedView.belongsTo(models.Account, {
      as: 'account',
      foreignKey: 'accountId',
    });
  };

  return ClientSavedView;
};
