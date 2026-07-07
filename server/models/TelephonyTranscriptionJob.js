module.exports = (sequelize, DataTypes) => {
  const TelephonyTranscriptionJob = sequelize.define('TelephonyTranscriptionJob', {
    telephonyCallId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('queued', 'processing', 'completed', 'failed'),
      allowNull: false,
      defaultValue: 'queued',
    },
    language: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    transcriptText: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    rawTranscriptText: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    rawAsrJson: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    corrections: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    workerId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    attemptCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    claimedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    completedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    failedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    createdByAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  });

  TelephonyTranscriptionJob.associate = (models) => {
    TelephonyTranscriptionJob.belongsTo(models.TelephonyCall, {
      as: 'call',
      foreignKey: 'telephonyCallId',
    });
    TelephonyTranscriptionJob.belongsTo(models.Account, {
      as: 'createdByAccount',
      foreignKey: 'createdByAccountId',
    });
    TelephonyTranscriptionJob.hasMany(models.TelephonyTranscriptSegment, {
      as: 'segments',
      foreignKey: 'transcriptionJobId',
    });
  };

  return TelephonyTranscriptionJob;
};
