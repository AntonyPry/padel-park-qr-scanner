module.exports = (sequelize, DataTypes) => {
  const TelephonyTranscriptionJob = sequelize.define('TelephonyTranscriptionJob', {
    organizationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    clubId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
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
    aiTranscriptText: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    aiTranscriptSegments: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    aiCorrections: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    aiMetadata: {
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
    claimId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    claimTokenHash: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    claimExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    claimWorkerCredentialId: {
      type: DataTypes.STRING(96),
      allowNull: true,
    },
    workerProtocolVersion: {
      type: DataTypes.INTEGER,
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
  }, {
    hooks: {
      beforeUpdate(job) {
        if (job.changed('organizationId') || job.changed('clubId')) {
          const error = new Error('Transcription job tenant attribution is immutable');
          error.code = 'TENANT_ATTRIBUTION_IMMUTABLE';
          throw error;
        }
      },
    },
  });

  TelephonyTranscriptionJob.associate = (models) => {
    TelephonyTranscriptionJob.belongsTo(models.Organization, {
      as: 'organization',
      foreignKey: 'organizationId',
    });
    TelephonyTranscriptionJob.belongsTo(models.Club, {
      as: 'club',
      foreignKey: 'clubId',
    });
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
