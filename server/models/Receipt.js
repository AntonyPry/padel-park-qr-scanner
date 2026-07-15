module.exports = (sequelize, DataTypes) => {
  const Receipt = sequelize.define('Receipt', {
    organizationId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    clubId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    integrationConnectionId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    idempotencyKey: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    evotorId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    dateTime: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    type: {
      type: DataTypes.STRING, // 'SELL' или 'PAYBACK'
      defaultValue: 'SELL',
    },
    totalAmount: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
    },
    cash: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
    },
    cashless: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
    },
    // --- НОВЫЕ ПОЛЯ ИЗ ЭВОТОРА ---
    employeeId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    shiftId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    totalTax: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
    },
    totalDiscount: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
    },
    paymentSource: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    paymentDetails: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    paymentParseStatus: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  }, {
    defaultScope: {
      attributes: { exclude: ['idempotencyKey', 'integrationConnectionId'] },
    },
    hooks: {
      beforeUpdate(receipt) {
        const fields = ['organizationId', 'clubId', 'integrationConnectionId', 'idempotencyKey'];
        if (fields.some((field) => receipt.changed(field))) {
          const error = new Error('Receipt provider attribution is immutable');
          error.code = 'PROVIDER_ATTRIBUTION_IMMUTABLE';
          throw error;
        }
      },
    },
  });

  Receipt.associate = (models) => {
    Receipt.belongsTo(models.IntegrationConnection, {
      as: 'integrationConnection',
      foreignKey: 'integrationConnectionId',
    });
    Receipt.hasMany(models.ReceiptItem, {
      as: 'items',
      foreignKey: 'receiptId',
    });
    Receipt.hasMany(models.PendingSale, {
      as: 'pendingSales',
      foreignKey: 'receiptId',
    });
    Receipt.hasMany(models.ClientSubscription, {
      as: 'clientSubscriptions',
      foreignKey: 'sourceReceiptId',
    });
    Receipt.hasMany(models.Certificate, {
      as: 'certificates',
      foreignKey: 'sourceReceiptId',
    });
  };

  return Receipt;
};
