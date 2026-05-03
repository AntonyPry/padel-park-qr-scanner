const express = require('express');
const router = express.Router();
const catalogController = require('../controllers/catalog.controller');

// Управление категориями P&L
router.get('/categories', catalogController.getCategories);
router.post('/categories', catalogController.createCategory);
router.delete('/categories/:id', catalogController.deleteCategory);

// Маппинг товаров
router.get('/unmapped', catalogController.getUnmapped);
router.get('/rules', catalogController.getRules);
router.post('/rules', catalogController.createRule);
router.delete('/rules/:id', catalogController.deleteRule);

module.exports = router;
