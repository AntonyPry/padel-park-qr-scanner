module.exports = (sequelize, DataTypes) => {
  const TelephonySubscription = sequelize.define('TelephonySubscription', {
    provider: {
      type: DataTypes.ENUM('beeline'),
      allowNull: false,
      defaultValue: 'beeline',
    },
    subscriptionId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('unknown', 'active', 'disabled', 'expired', 'failed'),
      allowNull: false,
      defaultValue: 'unknown',
    },
    subscriptionType: {
      type: DataTypes.ENUM('BASIC_CALL', 'ADVANCED_CALL'),
      allowNull: false,
      defaultValue: 'BASIC_CALL',
    },
    pattern: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    callbackUrl: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    expiresSeconds: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    lastCheckedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    lastRequest: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    lastResponse: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    lastError: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  });

  return TelephonySubscription;
};
