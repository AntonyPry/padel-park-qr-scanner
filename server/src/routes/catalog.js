const express = require('express');
const router = express.Router();
const catalogController = require('../controllers/catalog.controller');
const { requireRole } = require('../middleware/auth');
const { ACCESS_MATRIX } = require('../constants/access-matrix');

const viewCatalog = requireRole(...ACCESS_MATRIX.catalogView);
const manageCatalog = requireRole(...ACCESS_MATRIX.catalogManage);

// Управление категориями P&L
router.get('/categories', viewCatalog, catalogController.getCategories);
router.post('/categories', manageCatalog, catalogController.createCategory);
router.put('/categories/:id', manageCatalog, catalogController.updateCategory);
router.post(
  '/categories/:id/restore',
  manageCatalog,
  catalogController.restoreCategory,
);
router.delete(
  '/categories/:id/permanent',
  manageCatalog,
  catalogController.removeArchivedCategory,
);
router.delete('/categories/:id', manageCatalog, catalogController.deleteCategory);

// Маппинг товаров
router.get('/unmapped', viewCatalog, catalogController.getUnmapped);
router.get('/rules', viewCatalog, catalogController.getRules);
router.post('/rules', manageCatalog, catalogController.createRule);
router.post('/rules/:id/restore', manageCatalog, catalogController.restoreRule);
router.delete(
  '/rules/:id/permanent',
  manageCatalog,
  catalogController.removeArchivedRule,
);
router.delete('/rules/:id', manageCatalog, catalogController.deleteRule);

module.exports = router;
