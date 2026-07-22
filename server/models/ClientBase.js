module.exports = (sequelize, DataTypes) => {
  const ClientBase = sequelize.define('ClientBase', {
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
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    filters: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    origin: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    originMetadata: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    originOrganizationId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    originClubId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('active', 'archived'),
      allowNull: false,
      defaultValue: 'active',
    },
    createdByAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    lastCalculatedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    lastTaskCreatedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    lastTaskClientCount: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    slaDays: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    recurringEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    recurringInterval: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'none',
    },
    recurringWeekday: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    recurringTime: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    recurringScopeType: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'snapshot',
    },
    recurringDueDays: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    recurringAssignedToAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    recurringTitle: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    recurringDescription: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    recurringNextRunAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    recurringLastRunAt: {
      type: DataTypes.DATE,
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
    trainingSessionId: { type: DataTypes.UUID, allowNull: true },
  }, {
    hooks: {
      beforeBulkUpdate(options) {
        const attributes = options.attributes || {};
        if ([
          'organizationId',
          'clubId',
          'createdByAccountId',
          'filters',
          'origin',
          'originMetadata',
          'originOrganizationId',
          'originClubId',
        ].some(
          (field) => Object.prototype.hasOwnProperty.call(attributes, field),
        )) {
          const error = new Error('Client base tenant attribution is immutable');
          error.code = 'CLIENT_BASE_TENANT_IMMUTABLE';
          throw error;
        }
      },
      beforeUpdate(base) {
        if (
          base.changed('organizationId') ||
          base.changed('clubId') ||
          base.changed('createdByAccountId')
        ) {
          const error = new Error('Client base tenant attribution is immutable');
          error.code = 'CLIENT_BASE_TENANT_IMMUTABLE';
          throw error;
        }
        if (
          base.previous('origin') === 'visits_analytics' &&
          ['filters', 'origin', 'originMetadata', 'originOrganizationId', 'originClubId']
            .some((field) => base.changed(field))
        ) {
          const error = new Error('Analytics client base provenance is immutable');
          error.code = 'CLIENT_BASE_PROVENANCE_IMMUTABLE';
          throw error;
        }
      },
    },
  });

  ClientBase.associate = (models) => {
    ClientBase.belongsTo(models.Organization, { foreignKey: 'organizationId' });
    ClientBase.belongsTo(models.Club, { foreignKey: 'clubId' });
    ClientBase.belongsTo(models.Organization, {
      as: 'originOrganization',
      foreignKey: 'originOrganizationId',
    });
    ClientBase.belongsTo(models.Club, {
      as: 'originClub',
      foreignKey: 'originClubId',
    });
    ClientBase.belongsTo(models.Account, {
      as: 'createdByAccount',
      foreignKey: 'createdByAccountId',
    });
    ClientBase.belongsTo(models.Account, {
      as: 'recurringAssignedToAccount',
      foreignKey: 'recurringAssignedToAccountId',
    });
    ClientBase.hasMany(models.CallTask, {
      as: 'callTasks',
      foreignKey: 'clientBaseId',
    });
  };

  return ClientBase;
};
