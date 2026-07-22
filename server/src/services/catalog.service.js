const db = require('../../models');
const { PNL_GROUPS, PNL_GROUP_VALUES } = require('../constants/catalog');
const cacheService = require('./cache.service');

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

function serializeRule(rule) {
  const raw = rule.toJSON ? rule.toJSON() : rule;
  return { ...raw };
}

function getCatalogListCacheKey(scope, query = {}, tenant = null) {
  if (cacheService.isTenantIsolationEnabled()) {
    const tenantScope = scope === 'categories' ? 'organization' : 'club';
    return cacheService.tenantCacheKey(
      {
        domain: 'catalog',
        scope: tenantScope,
        suffix: `${scope}:list`,
        tenant,
      },
      { status: query.status || 'active' },
    );
  }
  return cacheService.cacheKey(`catalog:${scope}:list`, {
    status: query.status || 'active',
  });
}

async function invalidateCatalogCategories(tenant = null) {
  if (cacheService.isTenantIsolationEnabled()) {
    await cacheService.deleteTenantByPrefix({
      domain: 'catalog',
      scope: 'organization',
      suffix: 'categories',
      tenant,
    });
    return;
  }
  await cacheService.deleteByPrefix('catalog:categories:');
}

async function invalidateCatalogRules(tenant = null) {
  if (cacheService.isTenantIsolationEnabled()) {
    await cacheService.deleteTenantByPrefix({
      domain: 'catalog',
      scope: 'club',
      suffix: 'rules',
      tenant,
    });
    return;
  }
  await cacheService.deleteByPrefix('catalog:rules:');
}

async function invalidateCatalogCache(tenant = null) {
  if (!cacheService.isTenantIsolationEnabled()) {
    await Promise.all([invalidateCatalogCategories(), invalidateCatalogRules()]);
    return;
  }

  await invalidateCatalogCategories(tenant);
  if (tenant?.scope === 'club') {
    await invalidateCatalogRules(tenant);
    return;
  }
  const clubs = await db.Club.findAll({
    attributes: ['id'],
    where: { organizationId: tenant.organizationId },
  });
  await Promise.all(
    clubs.map((club) =>
      invalidateCatalogRules(
        cacheService.deriveClubCacheContext(tenant, club.id),
      ),
    ),
  );
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
  async getCategoriesFromDb(query = {}) {
    const categories = await db.Category.findAll({
      where: getArchiveWhere(query),
      order: [['name', 'ASC']],
    });
    return categories.map(serializeCategory);
  }

  async getCategories(query = {}, tenant = null) {
    if (cacheService.isTenantIsolationEnabled() && !tenant) {
      return this.getCategoriesFromDb(query);
    }
    if (cacheService.isTenantIsolationEnabled()) {
      return cacheService.rememberTenantJson(
        {
          domain: 'catalog',
          scope: 'organization',
          suffix: 'categories:list',
          tenant,
        },
        { status: query.status || 'active' },
        () => this.getCategoriesFromDb(query),
        { ttlSeconds: 300 },
      );
    }
    return cacheService.rememberJson(
      getCatalogListCacheKey('categories', query, tenant),
      () => this.getCategoriesFromDb(query),
      { ttlSeconds: 300 },
    );
  }

  async createCategory(data, tenant = null) {
    const parent = await getParentOrFail(data.parentId);
    const group = parent ? parent.group : normalizeGroup(data.group);
    const type = PNL_GROUPS[group].type;
    const name = normalizeName(data.name, 'Название категории');

    await assertCategoryNameAvailable(name);

    try {
      const category = await db.Category.create({
        name,
        type,
        group,
        commissionPercent: normalizeCommissionPercent(data.commissionPercent),
        isActive: true,
        parentId: parent ? parent.id : null,
      });
      await invalidateCatalogCategories(tenant);
      return serializeCategory(category);
    } catch (error) {
      if (isUniqueError(error)) {
        throw appError('Категория с таким названием уже существует', 409);
      }

      throw error;
    }
  }

  async updateCategory(id, data, tenant = null) {
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
      const updatedCategory = await category.update(payload);
      await invalidateCatalogCache(tenant);
      return serializeCategory(updatedCategory);
    } catch (error) {
      if (isUniqueError(error)) {
        throw appError('Категория с таким названием уже существует', 409);
      }

      throw error;
    }
  }

  async deleteCategory(id, tenant = null) {
    return this.archiveCategory(id, tenant);
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

  async archiveCategory(id, tenant = null) {
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

    await invalidateCatalogCache(tenant);
    return { success: true };
  }

  async restoreCategory(id, tenant = null) {
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

    await invalidateCatalogCache(tenant);
    return { success: true };
  }

  async removeArchivedCategory(id, tenant = null) {
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
    const financeRecords = await db.Finance.count({
      where: {
        category: {
          [db.Sequelize.Op.in]: allNames,
        },
      },
    });
    if (financeRecords > 0) {
      throw appError(
        'Категорию нельзя удалить безвозвратно: по ней есть финансовая история. Оставьте ее в архиве.',
        409,
      );
    }

    const linkedRules = await db.CatalogRule.findAll({
      attributes: ['itemName'],
      where: {
        category: {
          [db.Sequelize.Op.in]: allNames,
        },
      },
    });
    const linkedItemNames = Array.from(
      new Set(
        linkedRules
          .map((rule) => String(rule.itemName || '').trim())
          .filter(Boolean),
      ),
    );
    if (linkedItemNames.length > 0) {
      const receiptItems = await db.ReceiptItem.count({
        where: {
          name: {
            [db.Sequelize.Op.in]: linkedItemNames,
          },
        },
      });
      if (receiptItems > 0) {
        throw appError(
          'Категорию нельзя удалить безвозвратно: ее правила уже использовались в чеках. Оставьте ее в архиве.',
          409,
        );
      }
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
    await invalidateCatalogCache(tenant);
    return { success: true };
  }

  // --- ПРАВИЛА (БЕЗ ХАРДКОДА!) ---
  async getUnmappedItems(tenant = null) {
    const rules = await this.getRules({ status: 'active' }, tenant);
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

  async getRulesFromDb(query = {}) {
    const rules = await db.CatalogRule.findAll({
      order: [['createdAt', 'DESC']],
      where: getRuleArchiveWhere(query),
    });
    return rules.map(serializeRule);
  }

  async getRules(query = {}, tenant = null) {
    if (cacheService.isTenantIsolationEnabled() && !tenant) {
      return this.getRulesFromDb(query);
    }
    if (cacheService.isTenantIsolationEnabled()) {
      return cacheService.rememberTenantJson(
        {
          domain: 'catalog',
          scope: 'club',
          suffix: 'rules:list',
          tenant,
        },
        { status: query.status || 'active' },
        () => this.getRulesFromDb(query),
        { ttlSeconds: 300 },
      );
    }
    return cacheService.rememberJson(
      getCatalogListCacheKey('rules', query, tenant),
      () => this.getRulesFromDb(query),
      { ttlSeconds: 300 },
    );
  }

  async saveRule({ itemName, category }, tenant = null) {
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

    const result = await db.CatalogRule.upsert({
      itemName: normalizedItemName,
      category: catalogCategory.name,
      status: 'active',
      archivedByCascadeCategoryId: null,
    });
    await invalidateCatalogRules(tenant);
    return result;
  }

  async deleteRule(id, tenant = null) {
    const rule = await db.CatalogRule.findByPk(id);
    if (!rule) throw appError('Правило справочника не найдено', 404);
    await rule.update({
      status: 'archived',
      archivedByCascadeCategoryId: null,
    });
    await invalidateCatalogRules(tenant);
    return rule;
  }

  async restoreRule(id, tenant = null) {
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
    await invalidateCatalogRules(tenant);
    return rule;
  }

  async removeArchivedRule(id, tenant = null) {
    const rule = await db.CatalogRule.findByPk(id);
    if (!rule) throw appError('Правило справочника не найдено', 404);
    if (rule.status !== 'archived') {
      throw appError('Удалять безвозвратно можно только правило из архива', 409);
    }
    await rule.destroy();
    await invalidateCatalogRules(tenant);
    return { success: true };
  }
}

module.exports = new CatalogService();
