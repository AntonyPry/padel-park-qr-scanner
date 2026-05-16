const express = require('express');
const accountsController = require('../controllers/accounts.controller');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
const manageAccounts = requireRole('owner', 'manager');

router.get('/accounts', manageAccounts, accountsController.getAll);
router.post('/accounts', manageAccounts, accountsController.create);
router.put('/accounts/:id', manageAccounts, accountsController.update);
router.delete('/accounts/:id', manageAccounts, accountsController.remove);

module.exports = router;
