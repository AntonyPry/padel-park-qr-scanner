const motivationService = require('../services/motivation.service');

class MotivationController {
  async getCurrentSales(req, res) {
    try {
      res.json(await motivationService.getCurrentShiftSales());
    } catch (error) {
      console.error('Ошибка получения продаж смены:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  }

  async getRules(req, res) {
    try {
      res.json(await motivationService.getRules());
    } catch (error) {
      console.error('Ошибка получения правил мотивации:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  }

  async getBonusRules(req, res) {
    try {
      res.json(await motivationService.getBonusRules());
    } catch (error) {
      console.error('Ошибка получения бонусных правил мотивации:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  }

  async getCategories(req, res) {
    try {
      res.json(await motivationService.getAvailableCategories());
    } catch (error) {
      console.error('Ошибка получения категорий мотивации:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  }

  async updateRule(req, res) {
    try {
      const rule = await motivationService.updateRule(req.params.key, req.body);
      res.json(rule);
    } catch (error) {
      res
        .status(error.statusCode || 500)
        .json({ error: error.message || 'Ошибка обновления правила' });
    }
  }

  async createBonusRule(req, res) {
    try {
      const rule = await motivationService.createBonusRule(req.body);
      res.status(201).json(rule);
    } catch (error) {
      res
        .status(error.statusCode || 500)
        .json({ error: error.message || 'Ошибка создания бонусного правила' });
    }
  }

  async updateBonusRule(req, res) {
    try {
      const rule = await motivationService.updateBonusRule(
        req.params.id,
        req.body,
      );
      res.json(rule);
    } catch (error) {
      res
        .status(error.statusCode || 500)
        .json({ error: error.message || 'Ошибка обновления бонусного правила' });
    }
  }

  async deleteBonusRule(req, res) {
    try {
      res.json(await motivationService.deleteBonusRule(req.params.id));
    } catch (error) {
      res
        .status(error.statusCode || 500)
        .json({ error: error.message || 'Ошибка удаления бонусного правила' });
    }
  }
}

module.exports = new MotivationController();
