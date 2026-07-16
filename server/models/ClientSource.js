module.exports = (sequelize, DataTypes) => {
  const ClientSource = sequelize.define('ClientSource', {
    organizationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
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
  }, {
    indexes: [
      { unique: true, fields: ['organizationId', 'name'], name: 'uq_client_sources_organization_name' },
    ],
    hooks: {
      beforeBulkUpdate(options) {
        if (Object.prototype.hasOwnProperty.call(options.attributes || {}, 'organizationId')) {
          const error = new Error('Client source organization is immutable');
          error.code = 'CLIENT_REFERENCE_ORGANIZATION_IMMUTABLE';
          throw error;
        }
      },
      beforeUpdate(row) {
        if (row.changed('organizationId')) {
          const error = new Error('Client source organization is immutable');
          error.code = 'CLIENT_REFERENCE_ORGANIZATION_IMMUTABLE';
          throw error;
        }
      },
    },
  });

  ClientSource.associate = (models) => {
    ClientSource.belongsTo(models.Organization, {
      foreignKey: 'organizationId',
    });
    ClientSource.hasMany(models.User, {
      foreignKey: 'sourceId',
    });
  };

  return ClientSource;
};
