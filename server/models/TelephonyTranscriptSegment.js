module.exports = (sequelize, DataTypes) => {
  const TelephonyTranscriptSegment = sequelize.define('TelephonyTranscriptSegment', {
    transcriptionJobId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    telephonyCallId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    speaker: {
      type: DataTypes.ENUM('administrator', 'client', 'unknown'),
      allowNull: false,
      defaultValue: 'unknown',
    },
    channel: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    text: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    startMs: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    endMs: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    confidence: {
      type: DataTypes.DECIMAL(6, 5),
      allowNull: true,
    },
    sortOrder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  });

  TelephonyTranscriptSegment.associate = (models) => {
    TelephonyTranscriptSegment.belongsTo(models.TelephonyTranscriptionJob, {
      as: 'job',
      foreignKey: 'transcriptionJobId',
    });
    TelephonyTranscriptSegment.belongsTo(models.TelephonyCall, {
      as: 'call',
      foreignKey: 'telephonyCallId',
    });
  };

  return TelephonyTranscriptSegment;
};
