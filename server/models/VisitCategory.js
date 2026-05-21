module.exports = (sequelize, DataTypes) => {
  const VisitCategory = sequelize.define('VisitCategory', {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    status: {
      type: DataTypes.ENUM('active', 'archived'),
      allowNull: false,
      defaultValue: 'active',
    },
    sortOrder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  });

  VisitCategory.associate = (models) => {
    VisitCategory.belongsToMany(models.Visit, {
      through: models.VisitCategoryAssignment,
      foreignKey: 'visitCategoryId',
      otherKey: 'visitId',
      as: 'visits',
      timestamps: false,
    });
  };

  return VisitCategory;
};
