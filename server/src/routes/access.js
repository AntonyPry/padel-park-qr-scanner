const express = require('express');
const accessController = require('../controllers/access.controller');
const { requireRole } = require('../middleware/auth');
const { ACCESS_MATRIX } = require('../constants/access-matrix');

const router = express.Router();
const operateAccess = requireRole(...ACCESS_MATRIX.accessOperate);

router.get('/search', operateAccess, accessController.search);
router.post('/manual-visit', operateAccess, accessController.manualVisit);
router.post('/key', operateAccess, accessController.issueKey);
router.post('/scan', operateAccess, accessController.scan);
router.get('/scanner-events', operateAccess, accessController.getScannerEvents);
router.post('/scanner-events', operateAccess, accessController.recordScannerEvent);
router.post('/register', operateAccess, accessController.register);
router.get('/visits', operateAccess, accessController.getVisits);
router.post('/visit/category', operateAccess, accessController.updateVisitCategory);

module.exports = router;
