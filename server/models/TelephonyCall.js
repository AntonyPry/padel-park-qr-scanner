module.exports = (sequelize, DataTypes) => {
  const TelephonyCall = sequelize.define('TelephonyCall', {
    provider: {
      type: DataTypes.ENUM('beeline'),
      allowNull: false,
      defaultValue: 'beeline',
    },
    externalCallId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    externalTrackingId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    recordId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    recordExternalId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    clientPhone: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    clientPhoneNormalized: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    employeePhone: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    beelineUserId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    abonentExtension: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    staffId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    direction: {
      type: DataTypes.ENUM('inbound', 'outbound', 'unknown'),
      allowNull: false,
      defaultValue: 'unknown',
    },
    callStatus: {
      type: DataTypes.ENUM(
        'new',
        'ringing',
        'answered',
        'completed',
        'missed',
        'failed',
        'unknown',
      ),
      allowNull: false,
      defaultValue: 'new',
    },
    processingStatus: {
      type: DataTypes.ENUM('new', 'in_progress', 'processed', 'ignored'),
      allowNull: false,
      defaultValue: 'new',
    },
    startedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    answeredAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    endedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    durationSeconds: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    recordingStatus: {
      type: DataTypes.ENUM('unknown', 'pending', 'available', 'missing'),
      allowNull: false,
      defaultValue: 'unknown',
    },
    recordingUrl: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    recordingExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    recordingFileSize: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    recordingFileType: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    recordingSyncedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    result: {
      type: DataTypes.ENUM(
        'booked',
        'refused',
        'thinking',
        'callback',
        'complaint',
        'corporate',
        'no_answer',
        'other',
      ),
      allowNull: true,
    },
    interest: {
      type: DataTypes.ENUM(
        'game',
        'training',
        'tournament',
        'master_class',
        'corporate',
        'other',
      ),
      allowNull: true,
    },
    summary: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    nextActionAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    nextActionText: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    processedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    processedByAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    linkedBookingId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    followUpCallTaskId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    rawSnapshot: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  });

  TelephonyCall.associate = (models) => {
    TelephonyCall.belongsTo(models.User, {
      as: 'client',
      foreignKey: 'userId',
    });
    TelephonyCall.belongsTo(models.Staff, {
      as: 'staff',
      foreignKey: 'staffId',
    });
    TelephonyCall.belongsTo(models.Account, {
      as: 'processedByAccount',
      foreignKey: 'processedByAccountId',
    });
    TelephonyCall.belongsTo(models.Booking, {
      as: 'linkedBooking',
      foreignKey: 'linkedBookingId',
    });
    TelephonyCall.belongsTo(models.CallTask, {
      as: 'followUpCallTask',
      foreignKey: 'followUpCallTaskId',
    });
    TelephonyCall.hasMany(models.TelephonyRawEvent, {
      as: 'rawEvents',
      foreignKey: 'telephonyCallId',
    });
    TelephonyCall.hasMany(models.TelephonyTranscriptionJob, {
      as: 'transcriptionJobs',
      foreignKey: 'telephonyCallId',
    });
    TelephonyCall.hasMany(models.TelephonyTranscriptSegment, {
      as: 'transcriptSegments',
      foreignKey: 'telephonyCallId',
    });
  };

  return TelephonyCall;
};
