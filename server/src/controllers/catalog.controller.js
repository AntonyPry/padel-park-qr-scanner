const catalogService = require('../services/catalog.service');
const onboardingService = require('../services/onboarding.service');
const pendingSaleService = require('../services/pending-sale.service');
const { sendError } = require('../utils/api-error');

function handleError(res, error, fallback) {
  sendError(res, error, fallback);
}

class CatalogController {
  // Категории
  async getCategories(req, res) {
    try {
      res.json(await catalogService.getCategories(req.query, req.tenant));
    } catch (error) {
      handleError(res, error, 'Ошибка получения категорий');
    }
  }

  async createCategory(req, res) {
    try {
      const category = await catalogService.createCategory(req.body, req.tenant);
      await onboardingService.recordEventSafe(
        req.account,
        'catalog.category_updated',
        {
          entityId: category.id,
          entityType: 'catalog_category',
          payload: { categoryId: category.id, group: category.group },
        },
      );
      res.status(201).json(category);
    } catch (error) {
      handleError(res, error, 'Ошибка создания категории');
    }
  }

  async deleteCategory(req, res) {
    try {
      res.json(await catalogService.deleteCategory(req.params.id, req.tenant));
    } catch (error) {
      handleError(res, error, 'Ошибка удаления категории');
    }
  }

  async restoreCategory(req, res) {
    try {
      res.json(await catalogService.restoreCategory(req.params.id, req.tenant));
    } catch (error) {
      handleError(res, error, 'Ошибка восстановления категории');
    }
  }

  async removeArchivedCategory(req, res) {
    try {
      res.json(await catalogService.removeArchivedCategory(req.params.id, req.tenant));
    } catch (error) {
      handleError(res, error, 'Ошибка удаления категории из архива');
    }
  }

  async updateCategory(req, res) {
    try {
      const updated = await catalogService.updateCategory(
        req.params.id,
        req.body,
        req.tenant,
      );
      await onboardingService.recordEventSafe(
        req.account,
        'catalog.category_updated',
        {
          entityId: updated.id,
          entityType: 'catalog_category',
          payload: { categoryId: updated.id, group: updated.group },
        },
      );
      res.json(updated);
    } catch (error) {
      handleError(res, error, 'Ошибка обновления категории');
    }
  }

  // Правила (Маппинг)
  async getUnmapped(req, res) {
    try {
      res.json(await catalogService.getUnmappedItems(req.tenant));
    } catch (error) {
      handleError(res, error, 'Ошибка получения неразобранных товаров');
    }
  }

  async getRules(req, res) {
    try {
      res.json(await catalogService.getRules(req.query, req.tenant));
    } catch (error) {
      handleError(res, error, 'Ошибка получения правил');
    }
  }

  async createRule(req, res) {
    try {
      const result = await catalogService.saveRule(req.body, req.tenant);
      await onboardingService.recordEventSafe(req.account, 'catalog.rule_updated', {
        entityType: 'catalog_rule',
        payload: {
          category: req.body.category,
          itemName: req.body.itemName,
        },
      });
      res.status(201).json(result);
    } catch (error) {
      handleError(res, error, 'Ошибка создания правила');
    }
  }

  async deleteRule(req, res) {
    try {
      res.json(await catalogService.deleteRule(req.params.id, req.tenant));
    } catch (error) {
      handleError(res, error, 'Ошибка удаления правила');
    }
  }

  async restoreRule(req, res) {
    try {
      const rule = await catalogService.restoreRule(req.params.id, req.tenant);
      await onboardingService.recordEventSafe(req.account, 'catalog.rule_updated', {
        entityId: rule.id,
        entityType: 'catalog_rule',
        payload: {
          category: rule.category,
          itemName: rule.itemName,
          ruleId: rule.id,
        },
      });
      res.json(rule);
    } catch (error) {
      handleError(res, error, 'Ошибка восстановления правила');
    }
  }

  async removeArchivedRule(req, res) {
    try {
      res.json(await catalogService.removeArchivedRule(req.params.id, req.tenant));
    } catch (error) {
      handleError(res, error, 'Ошибка удаления правила из архива');
    }
  }

  // Настройки продаж Эвотора
  async getSaleSettings(req, res) {
    try {
      res.json(await pendingSaleService.getSaleSettings(req.tenant));
    } catch (error) {
      handleError(res, error, 'Ошибка получения настроек продаж');
    }
  }

  async saveSaleSetting(req, res) {
    try {
      const setting = await pendingSaleService.saveSaleSetting(
        req.body,
        req.account,
        req.tenant,
      );
      res.status(201).json(setting);
    } catch (error) {
      handleError(res, error, 'Ошибка сохранения настройки продажи');
    }
  }

  // Очередь привязки продаж
  async getPendingSales(req, res) {
    try {
      res.json(await pendingSaleService.listPendingSales(req.query, req.tenant));
    } catch (error) {
      handleError(res, error, 'Ошибка получения очереди продаж');
    }
  }

  async linkPendingSale(req, res) {
    try {
      res.json(
        await pendingSaleService.linkPendingSale(
          req.params.id,
          req.body,
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка привязки продажи к клиенту');
    }
  }

  async ignorePendingSale(req, res) {
    try {
      res.json(
        await pendingSaleService.ignorePendingSale(
          req.params.id,
          req.body,
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка игнорирования продажи');
    }
  }

  async cancelPendingSale(req, res) {
    try {
      res.json(
        await pendingSaleService.cancelPendingSale(
          req.params.id,
          req.body,
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка отмены продажи');
    }
  }
}

module.exports = new CatalogController();
