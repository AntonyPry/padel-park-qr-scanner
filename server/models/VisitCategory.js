module.exports = (sequelize, DataTypes) => {
  const VisitCategory = sequelize.define('VisitCategory', {
    organizationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
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
  }, {
    indexes: [
      { unique: true, fields: ['organizationId', 'name'], name: 'uq_visit_categories_organization_name' },
    ],
    hooks: {
      beforeBulkUpdate(options) {
        if (Object.prototype.hasOwnProperty.call(options.attributes || {}, 'organizationId')) {
          const error = new Error('Visit category organization is immutable');
          error.code = 'CLIENT_REFERENCE_ORGANIZATION_IMMUTABLE';
          throw error;
        }
      },
      beforeUpdate(row) {
        if (row.changed('organizationId')) {
          const error = new Error('Visit category organization is immutable');
          error.code = 'CLIENT_REFERENCE_ORGANIZATION_IMMUTABLE';
          throw error;
        }
      },
    },
  });

  VisitCategory.associate = (models) => {
    VisitCategory.belongsTo(models.Organization, {
      foreignKey: 'organizationId',
    });
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
