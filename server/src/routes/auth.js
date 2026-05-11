const express = require('express');
const authController = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/status', authController.status);
router.post('/bootstrap', authController.bootstrap);
router.post('/login', authController.login);
router.get('/me', requireAuth, authController.me);

module.exports = router;
