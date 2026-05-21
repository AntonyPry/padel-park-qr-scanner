module.exports = (sequelize, DataTypes) => {
  const CatalogRule = sequelize.define('CatalogRule', {
    itemName: {
      type: DataTypes.STRING,
      unique: true, // Одному товару — одно правило
      allowNull: false,
    },
    category: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('active', 'archived'),
      allowNull: false,
      defaultValue: 'active',
    },
    archivedByCascadeCategoryId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  });
  return CatalogRule;
};
