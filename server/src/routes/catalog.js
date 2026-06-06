const express = require('express');
const router = express.Router();
const catalogController = require('../controllers/catalog.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');

const viewCatalog = requireRole(...ACCESS_MATRIX.catalogView);
const manageCatalog = requireRole(...ACCESS_MATRIX.catalogManage);
const managePrepaymentSettings = requireRole(
  ...ACCESS_MATRIX.prepaymentSettingsManage,
);
const viewPrepaymentSales = requireRole(...ACCESS_MATRIX.prepaymentSalesView);
const managePrepaymentSales = requireRole(
  ...ACCESS_MATRIX.prepaymentSalesManage,
);

// Управление категориями P&L
router.get('/categories', viewCatalog, validate({ query: apiSchemas.catalog.listQuery }), catalogController.getCategories);
router.post('/categories', manageCatalog, validate({ body: apiSchemas.catalog.categoryBody }), catalogController.createCategory);
router.put('/categories/:id', manageCatalog, validate({ body: apiSchemas.catalog.categoryUpdateBody, params: apiSchemas.catalog.withId.params }), catalogController.updateCategory);
router.post(
  '/categories/:id/restore',
  manageCatalog,
  validate(apiSchemas.catalog.withId),
  catalogController.restoreCategory,
);
router.delete(
  '/categories/:id/permanent',
  manageCatalog,
  validate(apiSchemas.catalog.withId),
  catalogController.removeArchivedCategory,
);
router.delete('/categories/:id', manageCatalog, validate(apiSchemas.catalog.withId), catalogController.deleteCategory);

// Настройки продаж Эвотора и очередь привязки
router.get(
  '/sale-settings',
  viewCatalog,
  catalogController.getSaleSettings,
);
router.post(
  '/sale-settings',
  managePrepaymentSettings,
  validate({ body: apiSchemas.catalog.saleSettingBody }),
  catalogController.saveSaleSetting,
);
router.get(
  '/pending-sales',
  viewPrepaymentSales,
  validate({ query: apiSchemas.catalog.pendingSalesQuery }),
  catalogController.getPendingSales,
);
router.post(
  '/pending-sales/:id/link',
  managePrepaymentSales,
  validate({
    body: apiSchemas.catalog.pendingSaleLinkBody,
    params: apiSchemas.catalog.withId.params,
  }),
  catalogController.linkPendingSale,
);
router.post(
  '/pending-sales/:id/ignore',
  managePrepaymentSales,
  validate({
    body: apiSchemas.catalog.pendingSaleReasonBody,
    params: apiSchemas.catalog.withId.params,
  }),
  catalogController.ignorePendingSale,
);
router.post(
  '/pending-sales/:id/cancel',
  managePrepaymentSales,
  validate({
    body: apiSchemas.catalog.pendingSaleReasonBody,
    params: apiSchemas.catalog.withId.params,
  }),
  catalogController.cancelPendingSale,
);

// Маппинг товаров
router.get('/unmapped', viewCatalog, catalogController.getUnmapped);
router.get('/rules', viewCatalog, validate({ query: apiSchemas.catalog.listQuery }), catalogController.getRules);
router.post('/rules', manageCatalog, validate({ body: apiSchemas.catalog.ruleBody }), catalogController.createRule);
router.post('/rules/:id/restore', manageCatalog, validate(apiSchemas.catalog.withId), catalogController.restoreRule);
router.delete(
  '/rules/:id/permanent',
  manageCatalog,
  validate(apiSchemas.catalog.withId),
  catalogController.removeArchivedRule,
);
router.delete('/rules/:id', manageCatalog, validate(apiSchemas.catalog.withId), catalogController.deleteRule);

module.exports = router;
