const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhook.controller');

// URL будет: POST /api/webhooks/evotor
router.post('/evotor', webhookController.handleEvotor);

module.exports = router;
