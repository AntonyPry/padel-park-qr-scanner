const express = require('express');
const accessController = require('../controllers/access.controller');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
const operateAccess = requireRole('owner', 'manager', 'admin');

router.get('/search', operateAccess, accessController.search);
router.post('/manual-visit', operateAccess, accessController.manualVisit);
router.post('/key', operateAccess, accessController.issueKey);
router.post('/scan', operateAccess, accessController.scan);
router.post('/register', operateAccess, accessController.register);
router.get('/visits', operateAccess, accessController.getVisits);
router.post('/visit/category', operateAccess, accessController.updateVisitCategory);

module.exports = router;
