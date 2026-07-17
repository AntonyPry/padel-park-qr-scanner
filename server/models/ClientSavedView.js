module.exports = (sequelize, DataTypes) => {
  const ClientSavedView = sequelize.define('ClientSavedView', {
    organizationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    clubId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    membershipId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
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
  }, {
    hooks: {
      beforeBulkUpdate(options) {
        const attributes = options.attributes || {};
        if (['organizationId', 'clubId', 'membershipId', 'accountId'].some(
          (field) => Object.prototype.hasOwnProperty.call(attributes, field),
        )) {
          const error = new Error('Client saved view tenant attribution is immutable');
          error.code = 'CLIENT_SAVED_VIEW_TENANT_IMMUTABLE';
          throw error;
        }
      },
      beforeUpdate(view) {
        if (['organizationId', 'clubId', 'membershipId', 'accountId'].some(
          (field) => view.changed(field),
        )) {
          const error = new Error('Client saved view tenant attribution is immutable');
          error.code = 'CLIENT_SAVED_VIEW_TENANT_IMMUTABLE';
          throw error;
        }
      },
    },
  });

  ClientSavedView.associate = (models) => {
    ClientSavedView.belongsTo(models.Account, {
      as: 'account',
      foreignKey: 'accountId',
    });
    ClientSavedView.belongsTo(models.Organization, { foreignKey: 'organizationId' });
    ClientSavedView.belongsTo(models.Club, { foreignKey: 'clubId' });
    ClientSavedView.belongsTo(models.Membership, { foreignKey: 'membershipId' });
  };

  return ClientSavedView;
};
