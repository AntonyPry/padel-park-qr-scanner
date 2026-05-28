const express = require('express');
const motivationController = require('../controllers/motivation.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');

const router = express.Router();
const viewMotivation = requireRole(...ACCESS_MATRIX.motivationView);
const manageMotivation = requireRole(...ACCESS_MATRIX.motivationManage);

router.get('/motivation/current-sales', viewMotivation, validate({ query: apiSchemas.motivation.currentSalesQuery }), motivationController.getCurrentSales);
router.get('/motivation/rules', viewMotivation, motivationController.getRules);
router.get(
  '/motivation/bonus-rules',
  viewMotivation,
  motivationController.getBonusRules,
);
router.get(
  '/motivation/categories',
  viewMotivation,
  motivationController.getCategories,
);
router.put(
  '/motivation/rules/:key',
  manageMotivation,
  validate(apiSchemas.motivation.rule),
  motivationController.updateRule,
);
router.put(
  '/motivation/categories/:categoryId/rule',
  manageMotivation,
  validate(apiSchemas.motivation.assignCategory),
  motivationController.assignCategoryToBonusRule,
);
router.post(
  '/motivation/bonus-rules',
  manageMotivation,
  validate({ body: apiSchemas.motivation.bonusRuleBody }),
  motivationController.createBonusRule,
);
router.put(
  '/motivation/bonus-rules/:id',
  manageMotivation,
  validate({
    body: apiSchemas.motivation.bonusRuleBody.partial().passthrough(),
    params: apiSchemas.motivation.withId.params,
  }),
  motivationController.updateBonusRule,
);
router.delete(
  '/motivation/bonus-rules/:id',
  manageMotivation,
  validate(apiSchemas.motivation.withId),
  motivationController.deleteBonusRule,
);

module.exports = router;
