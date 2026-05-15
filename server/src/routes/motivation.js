const express = require('express');
const motivationController = require('../controllers/motivation.controller');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
const viewMotivation = requireRole('owner', 'manager', 'admin');
const manageMotivation = requireRole('owner', 'manager');

router.get('/motivation/current-sales', viewMotivation, motivationController.getCurrentSales);
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
  motivationController.updateRule,
);
router.put(
  '/motivation/categories/:categoryId/rule',
  manageMotivation,
  motivationController.assignCategoryToBonusRule,
);
router.post(
  '/motivation/bonus-rules',
  manageMotivation,
  motivationController.createBonusRule,
);
router.put(
  '/motivation/bonus-rules/:id',
  manageMotivation,
  motivationController.updateBonusRule,
);
router.delete(
  '/motivation/bonus-rules/:id',
  manageMotivation,
  motivationController.deleteBonusRule,
);

module.exports = router;
