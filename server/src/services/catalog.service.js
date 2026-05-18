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

  const parent = await db.Category.findByPk(normalizedParentId);
  if (!parent) throw appError('Родительская категория не найдена', 404);

  return parent;
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
  async getCategories() {
    return await db.Category.findAll({ order: [['name', 'ASC']] });
  }

  async createCategory(data) {
    const parent = await getParentOrFail(data.parentId);
    const group = parent ? parent.group : normalizeGroup(data.group);
    const type = PNL_GROUPS[group].type;
    const name = normalizeName(data.name, 'Название категории');

    await assertCategoryNameAvailable(name);

    try {
      return await db.Category.create({
        name,
        type,
        group,
        commissionPercent: normalizeCommissionPercent(data.commissionPercent),
        parentId: parent ? parent.id : null,
      });
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
      return await category.update(payload);
    } catch (error) {
      if (isUniqueError(error)) {
        throw appError('Категория с таким названием уже существует', 409);
      }

      throw error;
    }
  }

  async deleteCategory(id) {
    const categoryToDelete = await db.Category.findByPk(id);
    if (!categoryToDelete) throw appError('Категория не найдена', 404);
    if (categoryToDelete.isSystem) {
      throw appError('Системную категорию нельзя удалить', 409);
    }

    // 1. Рекурсивная функция для поиска всех потомков (детей, внуков и т.д.)
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

    // Собираем всех потомков
    const allDescendants = await getAllDescendants(id);

    // Формируем полный список на удаление (Сам родитель + все его потомки)
    const categoriesToDelete = [categoryToDelete, ...allDescendants];

    // Вытаскиваем их ID и Имена
    const allIds = categoriesToDelete.map((c) => c.id);
    const allNames = categoriesToDelete.map((c) => c.name);

    // 2. Уничтожаем все правила маппинга для этой ветки.
    // Все товары, которые были в этих категориях, снова станут "Неразобранными"
    await db.CatalogRule.destroy({
      where: {
        category: {
          [db.Sequelize.Op.in]: allNames,
        },
      },
    });

    // 3. Уничтожаем все категории одним ударом
    return await db.Category.destroy({
      where: {
        id: {
          [db.Sequelize.Op.in]: allIds,
        },
      },
    });
  }

  // --- ПРАВИЛА (БЕЗ ХАРДКОДА!) ---
  async getUnmappedItems() {
    const rules = await db.CatalogRule.findAll();
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

  async getRules() {
    return await db.CatalogRule.findAll({ order: [['createdAt', 'DESC']] });
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
    });
  }

  async deleteRule(id) {
    const deleted = await db.CatalogRule.destroy({ where: { id } });
    if (!deleted) throw appError('Правило справочника не найдено', 404);
    return deleted;
  }
}

module.exports = new CatalogService();
