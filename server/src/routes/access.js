const express = require('express');
const accessController = require('../controllers/access.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');

const router = express.Router();
const operateAccess = requireRole(...ACCESS_MATRIX.accessOperate);

router.get('/search', operateAccess, validate({ query: apiSchemas.access.searchQuery }), accessController.search);
router.post('/manual-visit', operateAccess, validate(apiSchemas.access.manualVisit), accessController.manualVisit);
router.post('/key', operateAccess, validate(apiSchemas.access.issueKey), accessController.issueKey);
router.post('/scan', operateAccess, validate(apiSchemas.access.scan), accessController.scan);
router.get('/scanner-events', operateAccess, validate({ query: apiSchemas.access.scannerEventsQuery }), accessController.getScannerEvents);
router.post('/scanner-events', operateAccess, validate(apiSchemas.access.scannerEvent), accessController.recordScannerEvent);
router.post('/register', operateAccess, validate(apiSchemas.access.register), accessController.register);
router.get('/visits', operateAccess, accessController.getVisits);
router.post('/visit/category', operateAccess, validate(apiSchemas.access.visitCategory), accessController.updateVisitCategory);

module.exports = router;
