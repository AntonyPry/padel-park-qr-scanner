module.exports = (sequelize, DataTypes) => {
  const CallTask = sequelize.define('CallTask', {
    organizationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    clubId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    clientBaseId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    scriptText: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    scopeType: {
      type: DataTypes.ENUM('snapshot', 'dynamic'),
      allowNull: false,
      defaultValue: 'snapshot',
    },
    status: {
      type: DataTypes.ENUM('backlog', 'in_progress', 'done', 'archived'),
      allowNull: false,
      defaultValue: 'backlog',
    },
    assignedToAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    createdByAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    dueAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    snapshotClientCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
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
        if (['organizationId', 'clubId', 'clientBaseId', 'createdByAccountId'].some(
          (field) => Object.prototype.hasOwnProperty.call(attributes, field),
        )) {
          const error = new Error('Call task tenant attribution is immutable');
          error.code = 'CALL_TASK_TENANT_IMMUTABLE';
          throw error;
        }
      },
      beforeUpdate(task) {
        if (
          task.changed('organizationId') ||
          task.changed('clubId') ||
          task.changed('clientBaseId') ||
          task.changed('createdByAccountId')
        ) {
          const error = new Error('Call task tenant attribution is immutable');
          error.code = 'CALL_TASK_TENANT_IMMUTABLE';
          throw error;
        }
      },
    },
  });

  CallTask.associate = (models) => {
    CallTask.belongsTo(models.Organization, { foreignKey: 'organizationId' });
    CallTask.belongsTo(models.Club, { foreignKey: 'clubId' });
    CallTask.belongsTo(models.ClientBase, {
      as: 'clientBase',
      foreignKey: 'clientBaseId',
    });
    CallTask.belongsTo(models.Account, {
      as: 'assignedToAccount',
      foreignKey: 'assignedToAccountId',
    });
    CallTask.belongsTo(models.Account, {
      as: 'createdByAccount',
      foreignKey: 'createdByAccountId',
    });
    CallTask.hasMany(models.CallTaskClient, {
      as: 'clients',
      foreignKey: 'callTaskId',
    });
  };

  return CallTask;
};
