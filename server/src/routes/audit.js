const express = require('express');
const auditController = require('../controllers/audit.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');

const router = express.Router();
const viewAudit = requireRole(...ACCESS_MATRIX.auditView);

router.get('/audit-logs', viewAudit, validate({ query: apiSchemas.audit.listQuery }), auditController.getAll);

module.exports = router;
