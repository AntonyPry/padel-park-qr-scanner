module.exports = (sequelize, DataTypes) => {
  const VisitCategoryAssignment = sequelize.define(
    'VisitCategoryAssignment',
    {
      visitId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      visitCategoryId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
    },
    {
      timestamps: false,
    },
  );

  VisitCategoryAssignment.associate = (models) => {
    VisitCategoryAssignment.belongsTo(models.Visit, {
      foreignKey: 'visitId',
    });
    VisitCategoryAssignment.belongsTo(models.VisitCategory, {
      foreignKey: 'visitCategoryId',
    });
  };

  return VisitCategoryAssignment;
};
