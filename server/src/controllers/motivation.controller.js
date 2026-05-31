const motivationService = require('../services/motivation.service');
const onboardingService = require('../services/onboarding.service');
const { sendError } = require('../utils/api-error');

class MotivationController {
  async getCurrentSales(req, res) {
    try {
      const includePaymentSummary = ['true', '1'].includes(
        String(req.query.includePaymentSummary).toLowerCase(),
      );

      res.json(
        await motivationService.getCurrentShiftSales({
          includePaymentSummary,
        }),
      );
    } catch (error) {
      console.error('Ошибка получения продаж смены:', error);
      sendError(res, error, 'Ошибка получения продаж смены');
    }
  }

  async getRules(req, res) {
    try {
      res.json(await motivationService.getRules());
    } catch (error) {
      console.error('Ошибка получения правил мотивации:', error);
      sendError(res, error, 'Ошибка получения правил мотивации');
    }
  }

  async getBonusRules(req, res) {
    try {
      res.json(await motivationService.getBonusRules());
    } catch (error) {
      console.error('Ошибка получения бонусных правил мотивации:', error);
      sendError(res, error, 'Ошибка получения бонусных правил мотивации');
    }
  }

  async getCategories(req, res) {
    try {
      res.json(await motivationService.getAvailableCategories());
    } catch (error) {
      console.error('Ошибка получения категорий мотивации:', error);
      sendError(res, error, 'Ошибка получения категорий мотивации');
    }
  }

  async updateRule(req, res) {
    try {
      const rule = await motivationService.updateRule(req.params.key, req.body);
      await onboardingService.recordEventSafe(
        req.account,
        'motivation.rule_updated',
        {
          entityId: req.params.key,
          entityType: 'motivation_rule',
          payload: { key: req.params.key },
        },
      );
      res.json(rule);
    } catch (error) {
      sendError(res, error, 'Ошибка обновления правила');
    }
  }

  async createBonusRule(req, res) {
    try {
      const rule = await motivationService.createBonusRule(req.body);
      await onboardingService.recordEventSafe(
        req.account,
        'motivation.rule_updated',
        {
          entityId: rule.id,
          entityType: 'motivation_bonus_rule',
          payload: { ruleId: rule.id },
        },
      );
      res.status(201).json(rule);
    } catch (error) {
      sendError(res, error, 'Ошибка создания бонусного правила');
    }
  }

  async updateBonusRule(req, res) {
    try {
      const rule = await motivationService.updateBonusRule(
        req.params.id,
        req.body,
      );
      await onboardingService.recordEventSafe(
        req.account,
        'motivation.rule_updated',
        {
          entityId: rule.id,
          entityType: 'motivation_bonus_rule',
          payload: { ruleId: rule.id },
        },
      );
      res.json(rule);
    } catch (error) {
      sendError(res, error, 'Ошибка обновления бонусного правила');
    }
  }

  async assignCategoryToBonusRule(req, res) {
    try {
      const rules = await motivationService.assignCategoryToBonusRule(
        req.params.categoryId,
        req.body.bonusRuleId,
      );
      await onboardingService.recordEventSafe(
        req.account,
        'motivation.rule_updated',
        {
          entityId: req.params.categoryId,
          entityType: 'motivation_category_rule',
          payload: {
            bonusRuleId: req.body.bonusRuleId || null,
            categoryId: req.params.categoryId,
          },
        },
      );
      res.json(rules);
    } catch (error) {
      sendError(res, error, 'Ошибка обновления мотивации категории');
    }
  }

  async deleteBonusRule(req, res) {
    try {
      res.json(await motivationService.deleteBonusRule(req.params.id));
    } catch (error) {
      sendError(res, error, 'Ошибка удаления бонусного правила');
    }
  }
}

module.exports = new MotivationController();
