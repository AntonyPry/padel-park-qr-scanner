const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhook.controller');
const { requireRouteClassification } = require('../middleware/tenant-context');
const {
  ENDPOINT_CLASSIFICATIONS,
} = require('../tenant-context/route-scope-declarations');

router.use(
  requireRouteClassification(ENDPOINT_CLASSIFICATIONS.PROVIDER_INGRESS),
);

// URL будет: POST /api/webhooks/evotor
router.post('/evotor', webhookController.handleEvotor);

module.exports = router;
