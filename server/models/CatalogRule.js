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
  });
  return CatalogRule;
};
