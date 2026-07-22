module.exports = (sequelize, DataTypes) => {
  const VisitCategoryAssignment = sequelize.define(
    'VisitCategoryAssignment',
    {
      organizationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      clubId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
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
      hooks: {
        beforeBulkUpdate(options) {
          const attributes = options.attributes || {};
          if (
            Object.prototype.hasOwnProperty.call(attributes, 'organizationId') ||
            Object.prototype.hasOwnProperty.call(attributes, 'clubId')
          ) {
            const error = new Error('Visit category assignment tenant is immutable');
            error.code = 'VISIT_CATEGORY_ASSIGNMENT_TENANT_IMMUTABLE';
            throw error;
          }
        },
        beforeUpdate(row) {
          if (row.changed('organizationId') || row.changed('clubId')) {
            const error = new Error('Visit category assignment tenant is immutable');
            error.code = 'VISIT_CATEGORY_ASSIGNMENT_TENANT_IMMUTABLE';
            throw error;
          }
        },
      },
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
