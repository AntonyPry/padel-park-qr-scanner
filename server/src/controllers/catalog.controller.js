const catalogService = require('../services/catalog.service');

function handleError(res, error, fallback) {
  res
    .status(error.statusCode || 500)
    .json({ error: error.message || fallback });
}

class CatalogController {
  // Категории
  async getCategories(req, res) {
    try {
      res.json(await catalogService.getCategories());
    } catch (error) {
      handleError(res, error, 'Ошибка получения категорий');
    }
  }

  async createCategory(req, res) {
    try {
      res.status(201).json(await catalogService.createCategory(req.body));
    } catch (error) {
      handleError(res, error, 'Ошибка создания категории');
    }
  }

  async deleteCategory(req, res) {
    try {
      res.json(await catalogService.deleteCategory(req.params.id));
    } catch (error) {
      handleError(res, error, 'Ошибка удаления категории');
    }
  }

  async updateCategory(req, res) {
    try {
      const updated = await catalogService.updateCategory(
        req.params.id,
        req.body,
      );
      res.json(updated);
    } catch (error) {
      handleError(res, error, 'Ошибка обновления категории');
    }
  }

  // Правила (Маппинг)
  async getUnmapped(req, res) {
    try {
      res.json(await catalogService.getUnmappedItems());
    } catch (error) {
      handleError(res, error, 'Ошибка получения неразобранных товаров');
    }
  }

  async getRules(req, res) {
    try {
      res.json(await catalogService.getRules());
    } catch (error) {
      handleError(res, error, 'Ошибка получения правил');
    }
  }

  async createRule(req, res) {
    try {
      res.status(201).json(await catalogService.saveRule(req.body));
    } catch (error) {
      handleError(res, error, 'Ошибка создания правила');
    }
  }

  async deleteRule(req, res) {
    try {
      res.json(await catalogService.deleteRule(req.params.id));
    } catch (error) {
      handleError(res, error, 'Ошибка удаления правила');
    }
  }
}

module.exports = new CatalogController();
