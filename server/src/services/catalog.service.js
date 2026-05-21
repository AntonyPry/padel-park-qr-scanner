const db = require('../../models');
const { PNL_GROUPS, PNL_GROUP_VALUES } = require('../constants/catalog');

function appError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeName(value, fieldName = 'Название') {
  const name = String(value || '').trim();
  if (!name) throw appError(`${fieldName} обязательно`);
  return name;
}

function normalizeCategoryKey(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeGroup(value) {
  const group = String(value || 'OPEX').trim();
  if (!PNL_GROUP_VALUES.includes(group)) {
    throw appError('Неизвестная группа P&L');
  }

  return group;
}

function normalizeCommissionPercent(value) {
  const percent = value === undefined || value === '' ? 0 : Number(value);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw appError('Авто-комиссия должна быть числом от 0 до 100');
  }

  return percent;
}

async function getParentOrFail(parentId) {
  if (parentId === null || parentId === undefined || parentId === '') {
    return null;
  }

  const normalizedParentId = Number(parentId);
  if (!Number.isInteger(normalizedParentId)) {
    throw appError('Некорректная родительская категория');
  }

  const parent = await db.Category.findOne({
    where: { id: normalizedParentId, isActive: true },
  });
  if (!parent) throw appError('Родительская категория не найдена', 404);

  return parent;
}

function serializeCategory(category) {
  const raw = category.toJSON ? category.toJSON() : category;
  return {
    ...raw,
    status: raw.isActive ? 'active' : 'archived',
  };
}

function getArchiveWhere(query = {}) {
  const status = query.status || 'active';
  if (status === 'all') return {};
  if (status === 'active') return { isActive: true };
  if (status === 'archived') return { isActive: false };
  throw appError('Некорректный статус архива');
}

function getRuleArchiveWhere(query = {}) {
  const status = query.status || 'active';
  if (status === 'all') return {};
  if (status === 'active') return { status: 'active' };
  if (status === 'archived') return { status: 'archived' };
  throw appError('Некорректный статус архива');
}

function isUniqueError(error) {
  return error.name === 'SequelizeUniqueConstraintError';
}

async function assertCategoryNameAvailable(name, categoryId = null) {
  const where = { name };
  if (categoryId) {
    where.id = { [db.Sequelize.Op.ne]: Number(categoryId) };
  }

  const existing = await db.Category.findOne({ where });
  if (existing) {
    throw appError('Категория с таким названием уже существует', 409);
  }
}

class CatalogService {
  // --- КАТЕГОРИИ ---
  async getCategories(query = {}) {
    const categories = await db.Category.findAll({
      where: getArchiveWhere(query),
      order: [['name', 'ASC']],
    });
    return categories.map(serializeCategory);
  }

  async createCategory(data) {
    const parent = await getParentOrFail(data.parentId);
    const group = parent ? parent.group : normalizeGroup(data.group);
    const type = PNL_GROUPS[group].type;
    const name = normalizeName(data.name, 'Название категории');

    await assertCategoryNameAvailable(name);

    try {
      return serializeCategory(await db.Category.create({
        name,
        type,
        group,
        commissionPercent: normalizeCommissionPercent(data.commissionPercent),
        isActive: true,
        parentId: parent ? parent.id : null,
      }));
    } catch (error) {
      if (isUniqueError(error)) {
        throw appError('Категория с таким названием уже существует', 409);
      }

      throw error;
    }
  }

  async updateCategory(id, data) {
    const category = await db.Category.findByPk(id);
    if (!category) throw appError('Категория не найдена', 404);

    const payload = {};

    if ('name' in data) {
      payload.name = normalizeName(data.name, 'Название категории');
      await assertCategoryNameAvailable(payload.name, id);
    }

    if ('commissionPercent' in data) {
      payload.commissionPercent = normalizeCommissionPercent(
        data.commissionPercent,
      );
    }

    // ЗАЩИТА ОТ ЦИКЛОВ (Если пытаются изменить родителя)
    if (data.parentId !== undefined) {
      const newParentId = data.parentId === null ? null : Number(data.parentId);

      // 1. Нельзя быть родителем самому себе
      if (newParentId === Number(id)) {
        throw appError('Категория не может быть родителем самой себя');
      }

      // 2. Нельзя назначить родителем своего же потомка
      if (newParentId !== null) {
        let currentParent = await db.Category.findByPk(newParentId);
        if (!currentParent) {
          throw appError('Родительская категория не найдена', 404);
        }

        while (currentParent) {
          if (currentParent.id === Number(id)) {
            throw appError(
              'Обнаружен цикл: нельзя назначить потомка родителем',
            );
          }
          if (!currentParent.parentId) break; // Дошли до корня
          currentParent = await db.Category.findByPk(currentParent.parentId);
        }

        // Наследуем группу от нового родителя для консистентности
        const parentCat = await db.Category.findByPk(newParentId);
        if (parentCat) {
          payload.group = parentCat.group;
          payload.type = parentCat.type;
        }
      } else if ('group' in data) {
        const group = normalizeGroup(data.group);
        payload.group = group;
        payload.type = PNL_GROUPS[group].type;
      }

      payload.parentId = newParentId;
    } else if ('group' in data) {
      if (category.parentId) {
        throw appError('Группа дочерней категории наследуется от родителя');
      }

      const group = normalizeGroup(data.group);
      payload.group = group;
      payload.type = PNL_GROUPS[group].type;
    }

    try {
      return serializeCategory(await category.update(payload));
    } catch (error) {
      if (isUniqueError(error)) {
        throw appError('Категория с таким названием уже существует', 409);
      }

      throw error;
    }
  }

  async deleteCategory(id) {
    return this.archiveCategory(id);
  }

  async getCategoryBranch(id) {
    const categoryToDelete = await db.Category.findByPk(id);
    if (!categoryToDelete) throw appError('Категория не найдена', 404);

    const getAllDescendants = async (parentId) => {
      let descendants = [];
      const children = await db.Category.findAll({ where: { parentId } });

      for (const child of children) {
        descendants.push(child); // Добавляем текущего ребенка
        const subChildren = await getAllDescendants(child.id); // Ищем его детей
        descendants = descendants.concat(subChildren);
      }

      return descendants;
    };

    const allDescendants = await getAllDescendants(id);
    return [categoryToDelete, ...allDescendants];
  }

  async archiveCategory(id) {
    const categoryToArchive = await db.Category.findByPk(id);
    if (!categoryToArchive) throw appError('Категория не найдена', 404);
    if (categoryToArchive.isSystem) {
      throw appError('Системную категорию нельзя архивировать', 409);
    }

    const categoriesToArchive = await this.getCategoryBranch(id);
    const allIds = categoriesToArchive.map((category) => category.id);
    const allNames = categoriesToArchive.map((category) => category.name);

    await db.CatalogRule.update(
      {
        archivedByCascadeCategoryId: categoryToArchive.id,
        status: 'archived',
      },
      {
        where: {
          category: {
            [db.Sequelize.Op.in]: allNames,
          },
          status: 'active',
        },
      },
    );
    await Promise.all(
      categoriesToArchive.map((category) => {
        if (!category.isActive) return Promise.resolve();
        return category.update({
          archivedByCascadeParentId:
            category.id === categoryToArchive.id ? null : categoryToArchive.id,
          isActive: false,
        });
      }),
    );

    return { success: true };
  }

  async restoreCategory(id) {
    const categoriesToRestore = await this.getCategoryBranch(id);
    const root = categoriesToRestore[0];
    if (root.parentId) {
      const parent = await db.Category.findByPk(root.parentId);
      if (parent && !parent.isActive) {
        throw appError('Сначала восстановите родительскую категорию', 409);
      }
    }

    const categoriesForRestore = categoriesToRestore.filter(
      (category) =>
        category.id === root.id ||
        Number(category.archivedByCascadeParentId) === Number(root.id),
    );
    const allIds = categoriesForRestore.map((category) => category.id);

    await db.Category.update(
      {
        archivedByCascadeParentId: null,
        isActive: true,
      },
      {
        where: {
          id: {
            [db.Sequelize.Op.in]: allIds,
          },
        },
      },
    );
    await db.CatalogRule.update(
      {
        archivedByCascadeCategoryId: null,
        status: 'active',
      },
      {
        where: {
          archivedByCascadeCategoryId: root.id,
          status: 'archived',
        },
      },
    );

    return { success: true };
  }

  async removeArchivedCategory(id) {
    const categoryToDelete = await db.Category.findByPk(id);
    if (!categoryToDelete) throw appError('Категория не найдена', 404);
    if (categoryToDelete.isActive) {
      throw appError('Удалять безвозвратно можно только категории из архива', 409);
    }
    if (categoryToDelete.isSystem) {
      throw appError('Системную категорию нельзя удалить', 409);
    }

    const categoriesToDelete = await this.getCategoryBranch(id);
    const allIds = categoriesToDelete.map((category) => category.id);
    const allNames = categoriesToDelete.map((category) => category.name);
    const motivationLinks = await db.MotivationBonusRuleCategory.count({
      where: { categoryId: { [db.Sequelize.Op.in]: allIds } },
    });
    if (motivationLinks > 0) {
      throw appError(
        'Категорию нельзя удалить безвозвратно: она участвует в мотивации. Сначала уберите связь с мотивацией.',
        409,
      );
    }

    await db.CatalogRule.destroy({
      where: {
        category: {
          [db.Sequelize.Op.in]: allNames,
        },
      },
    });
    await db.Category.destroy({
      where: {
        id: {
          [db.Sequelize.Op.in]: allIds,
        },
      },
    });
    return { success: true };
  }

  // --- ПРАВИЛА (БЕЗ ХАРДКОДА!) ---
  async getUnmappedItems() {
    const rules = await db.CatalogRule.findAll({
      where: { status: 'active' },
    });
    const mappedNames = new Set(
      rules.map((rule) => normalizeCategoryKey(rule.itemName)),
    );

    const items = await db.ReceiptItem.findAll({
      attributes: ['name'],
      group: ['name'],
    });

    const unmapped = [];
    items.forEach((item) => {
      const itemName = String(item.name || '').trim();
      if (!itemName) return;
      if (!mappedNames.has(normalizeCategoryKey(itemName))) {
        unmapped.push(itemName);
      }
    });

    return unmapped;
  }

  async getRules(query = {}) {
    return await db.CatalogRule.findAll({
      order: [['createdAt', 'DESC']],
      where: getRuleArchiveWhere(query),
    });
  }

  async saveRule({ itemName, category }) {
    const normalizedItemName = normalizeName(itemName, 'Название товара');
    const normalizedCategoryName = normalizeName(category, 'Категория');
    const catalogCategory = await db.Category.findOne({
      where: {
        name: normalizedCategoryName,
        isActive: true,
      },
    });

    if (!catalogCategory) {
      throw appError('Категория справочника не найдена', 404);
    }

    return await db.CatalogRule.upsert({
      itemName: normalizedItemName,
      category: catalogCategory.name,
      status: 'active',
      archivedByCascadeCategoryId: null,
    });
  }

  async deleteRule(id) {
    const rule = await db.CatalogRule.findByPk(id);
    if (!rule) throw appError('Правило справочника не найдено', 404);
    await rule.update({
      status: 'archived',
      archivedByCascadeCategoryId: null,
    });
    return rule;
  }

  async restoreRule(id) {
    const rule = await db.CatalogRule.findByPk(id);
    if (!rule) throw appError('Правило справочника не найдено', 404);

    const category = await db.Category.findOne({
      where: { name: rule.category, isActive: true },
    });
    if (!category) {
      throw appError('Сначала восстановите категорию правила', 409);
    }

    await rule.update({
      status: 'active',
      archivedByCascadeCategoryId: null,
    });
    return rule;
  }

  async removeArchivedRule(id) {
    const rule = await db.CatalogRule.findByPk(id);
    if (!rule) throw appError('Правило справочника не найдено', 404);
    if (rule.status !== 'archived') {
      throw appError('Удалять безвозвратно можно только правило из архива', 409);
    }
    await rule.destroy();
    return { success: true };
  }
}

module.exports = new CatalogService();
