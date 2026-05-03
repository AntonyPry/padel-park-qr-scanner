const catalogService = require('../services/catalog.service');

class CatalogController {
  // Категории
  async getCategories(req, res) {
    res.json(await catalogService.getCategories());
  }
  async createCategory(req, res) {
    res.json(await catalogService.createCategory(req.body));
  }
  async deleteCategory(req, res) {
    res.json(await catalogService.deleteCategory(req.params.id));
  }

  // Правила (Маппинг)
  async getUnmapped(req, res) {
    res.json(await catalogService.getUnmappedItems());
  }
  async getRules(req, res) {
    res.json(await catalogService.getRules());
  }
  async createRule(req, res) {
    res.json(await catalogService.saveRule(req.body));
  }
  async deleteRule(req, res) {
    res.json(await catalogService.deleteRule(req.params.id));
  }
}

module.exports = new CatalogController();
