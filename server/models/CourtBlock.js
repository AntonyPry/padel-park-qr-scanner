module.exports = (sequelize, DataTypes) => {
  const CourtBlock = sequelize.define('CourtBlock', {
    courtId: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    startsAt: {
      allowNull: false,
      type: DataTypes.DATE,
    },
    endsAt: {
      allowNull: false,
      type: DataTypes.DATE,
    },
    reason: {
      allowNull: false,
      type: DataTypes.STRING,
    },
    status: {
      allowNull: false,
      defaultValue: 'active',
      type: DataTypes.ENUM('active', 'archived'),
    },
    createdByAccountId: {
      allowNull: true,
      type: DataTypes.INTEGER,
    },
    updatedByAccountId: {
      allowNull: true,
      type: DataTypes.INTEGER,
    },
  });

  CourtBlock.associate = (models) => {
    CourtBlock.belongsTo(models.Court, { foreignKey: 'courtId' });
    CourtBlock.belongsTo(models.Account, {
      as: 'createdBy',
      foreignKey: 'createdByAccountId',
    });
    CourtBlock.belongsTo(models.Account, {
      as: 'updatedBy',
      foreignKey: 'updatedByAccountId',
    });
  };

  return CourtBlock;
};
