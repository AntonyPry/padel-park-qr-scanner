const express = require('express');
const authController = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { apiSchemas } = require('../contracts/api-schemas');

const router = express.Router();

router.get('/status', authController.status);
router.post('/bootstrap', validate(apiSchemas.auth.bootstrap), authController.bootstrap);
router.post('/login', validate(apiSchemas.auth.login), authController.login);
router.get('/me', requireAuth, authController.me);

module.exports = router;
