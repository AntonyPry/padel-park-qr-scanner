module.exports = (sequelize, DataTypes) => {
  const Utilizations = sequelize.define('Utilizations', {
    organizationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    clubId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    // Корт 1 на 1 (бывший booked6)
    booked1: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
    },
    // Корты 2 на 2 (бывший booked15)
    booked2: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
    },
    // Новые поля для сессий
    sessions1: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    sessions2: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
  }, {
    hooks: {
      beforeBulkUpdate(options) {
        const attributes = options.attributes || {};
        if (['organizationId', 'clubId'].some((field) =>
          Object.prototype.hasOwnProperty.call(attributes, field))) {
          throw new Error('Utilization tenant attribution is immutable');
        }
      },
      beforeUpdate(row) {
        if (row.changed('organizationId') || row.changed('clubId')) {
          throw new Error('Utilization tenant attribution is immutable');
        }
      },
    },
  });

  Utilizations.associate = (models) => {
    Utilizations.belongsTo(models.Organization, { foreignKey: 'organizationId' });
    Utilizations.belongsTo(models.Club, { foreignKey: 'clubId' });
  };
  return Utilizations;
};
