const express = require('express');
const auditController = require('../controllers/audit.controller');
const { requireRole } = require('../middleware/auth');
const { ACCESS_MATRIX } = require('../constants/access-matrix');

const router = express.Router();
const viewAudit = requireRole(...ACCESS_MATRIX.auditView);

router.get('/audit-logs', viewAudit, auditController.getAll);

module.exports = router;
