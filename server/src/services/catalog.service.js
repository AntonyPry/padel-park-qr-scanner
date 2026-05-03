const db = require('../../models');

class CatalogService {
  // --- КАТЕГОРИИ ---
  async getCategories() {
    return await db.Category.findAll({ order: [['name', 'ASC']] });
  }

  async createCategory(data) {
    return await db.Category.create({
      name: data.name,
      type: data.type || 'income',
      group: data.group || 'OPEX',
      commissionPercent: Number(data.commissionPercent) || 0,
      parentId: data.parentId || null,
    });
  }

  async updateCategory(id, data) {
    const category = await db.Category.findByPk(id);
    if (!category) throw new Error('Категория не найдена');

    // ЗАЩИТА ОТ ЦИКЛОВ (Если пытаются изменить родителя)
    if (data.parentId !== undefined) {
      const newParentId = data.parentId === null ? null : Number(data.parentId);

      // 1. Нельзя быть родителем самому себе
      if (newParentId === Number(id)) {
        throw new Error('Категория не может быть родителем самой себя');
      }

      // 2. Нельзя назначить родителем своего же потомка
      if (newParentId !== null) {
        let currentParent = await db.Category.findByPk(newParentId);
        while (currentParent) {
          if (currentParent.id === Number(id)) {
            throw new Error(
              'Обнаружен цикл: нельзя назначить потомка родителем',
            );
          }
          if (!currentParent.parentId) break; // Дошли до корня
          currentParent = await db.Category.findByPk(currentParent.parentId);
        }

        // Наследуем группу от нового родителя для консистентности
        const parentCat = await db.Category.findByPk(newParentId);
        if (parentCat) data.group = parentCat.group;
      }

      data.parentId = newParentId;
    }

    return await category.update(data);
  }

  async deleteCategory(id) {
    const categoryToDelete = await db.Category.findByPk(id);
    if (!categoryToDelete) return false;

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
    const mappedNames = new Set(rules.map((r) => r.itemName.toLowerCase()));

    const items = await db.ReceiptItem.findAll({
      attributes: ['name'],
      group: ['name'],
    });

    const unmapped = [];
    items.forEach((item) => {
      if (!mappedNames.has(item.name.toLowerCase())) {
        unmapped.push(item.name);
      }
    });

    return unmapped;
  }

  async getRules() {
    return await db.CatalogRule.findAll({ order: [['createdAt', 'DESC']] });
  }

  async saveRule({ itemName, category }) {
    return await db.CatalogRule.upsert({ itemName, category });
  }

  async deleteRule(id) {
    return await db.CatalogRule.destroy({ where: { id } });
  }
}

module.exports = new CatalogService();
