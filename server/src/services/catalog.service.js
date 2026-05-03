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
    });
  }

  async deleteCategory(id) {
    return await db.Category.destroy({ where: { id } });
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
