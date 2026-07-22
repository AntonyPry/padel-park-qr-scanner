const {
  isTenantAuditLogEnabled,
} = require('../src/tenant-context/capabilities');
const {
  loadDefaultTenant,
  missingTenantError,
} = require('../src/tenant-context/model-attribution');
const {
  immutableAttributionError,
} = require('../src/provider-integrations/immutable-attribution');

module.exports = (sequelize, DataTypes) => {
  const AuditLog = sequelize.define('AuditLog', {
    organizationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    clubId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    accountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    role: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    action: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    entityType: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    entityId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    method: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    path: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    statusCode: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    summary: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  }, {
    hooks: {
      async beforeBulkCreate(instances, options) {
        await Promise.all(instances.map(async (instance) => {
          if (Number.isSafeInteger(Number(instance.organizationId))) return;
          if (isTenantAuditLogEnabled()) throw missingTenantError('AuditLog');
          const tenant = await loadDefaultTenant(instance, options);
          instance.set('organizationId', tenant.organizationId);
        }));
      },
      beforeBulkDestroy() {
        throw immutableAttributionError('AuditLog rows are immutable');
      },
      beforeBulkUpdate() {
        throw immutableAttributionError('AuditLog rows are immutable');
      },
      beforeDestroy() {
        throw immutableAttributionError('AuditLog rows are immutable');
      },
      async beforeValidate(instance, options) {
        if (!instance.isNewRecord) {
          throw immutableAttributionError('AuditLog rows are immutable');
        }
        if (!Number.isSafeInteger(Number(instance.organizationId))) {
          if (isTenantAuditLogEnabled()) throw missingTenantError('AuditLog');
          const tenant = await loadDefaultTenant(instance, options);
          instance.set('organizationId', tenant.organizationId);
        }
      },
      beforeUpdate() {
        throw immutableAttributionError('AuditLog rows are immutable');
      },
    },
  });

  AuditLog.associate = (models) => {
    AuditLog.belongsTo(models.Account, {
      as: 'account',
      constraints: false,
      foreignKey: 'accountId',
    });
    AuditLog.belongsTo(models.Organization, {
      as: 'organization',
      foreignKey: 'organizationId',
    });
    AuditLog.belongsTo(models.Club, {
      as: 'club',
      constraints: false,
      foreignKey: 'clubId',
    });
  };

  return AuditLog;
};
