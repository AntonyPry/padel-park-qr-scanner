const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use('/telephony', requireAuth, (_req, res) =>
  res.status(410).json({
    code: 'TELEPHONY_REMOVED',
    error: 'Раздел телефонии удалён',
    status: 410,
  }));

module.exports = router;
