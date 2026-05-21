const catalogService = require('../services/catalog.service');
const { sendError } = require('../utils/api-error');

function handleError(res, error, fallback) {
  sendError(res, error, fallback);
}

class CatalogController {
  // Категории
  async getCategories(req, res) {
    try {
      res.json(await catalogService.getCategories(req.query));
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

  async restoreCategory(req, res) {
    try {
      res.json(await catalogService.restoreCategory(req.params.id));
    } catch (error) {
      handleError(res, error, 'Ошибка восстановления категории');
    }
  }

  async removeArchivedCategory(req, res) {
    try {
      res.json(await catalogService.removeArchivedCategory(req.params.id));
    } catch (error) {
      handleError(res, error, 'Ошибка удаления категории из архива');
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
      res.json(await catalogService.getRules(req.query));
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

  async restoreRule(req, res) {
    try {
      res.json(await catalogService.restoreRule(req.params.id));
    } catch (error) {
      handleError(res, error, 'Ошибка восстановления правила');
    }
  }

  async removeArchivedRule(req, res) {
    try {
      res.json(await catalogService.removeArchivedRule(req.params.id));
    } catch (error) {
      handleError(res, error, 'Ошибка удаления правила из архива');
    }
  }
}

module.exports = new CatalogController();
