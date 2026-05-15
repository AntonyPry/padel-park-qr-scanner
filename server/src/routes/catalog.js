const express = require('express');
const router = express.Router();
const catalogController = require('../controllers/catalog.controller');
const { requireRole } = require('../middleware/auth');

const viewCatalog = requireRole('owner', 'manager', 'accountant', 'viewer');
const manageCatalog = requireRole('owner', 'accountant');

// Управление категориями P&L
router.get('/categories', viewCatalog, catalogController.getCategories);
router.post('/categories', manageCatalog, catalogController.createCategory);
router.delete('/categories/:id', manageCatalog, catalogController.deleteCategory);
router.put('/categories/:id', manageCatalog, catalogController.updateCategory);

// Маппинг товаров
router.get('/unmapped', viewCatalog, catalogController.getUnmapped);
router.get('/rules', viewCatalog, catalogController.getRules);
router.post('/rules', manageCatalog, catalogController.createRule);
router.delete('/rules/:id', manageCatalog, catalogController.deleteRule);

module.exports = router;
