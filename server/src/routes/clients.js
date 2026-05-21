const express = require('express');
const clientsController = require('../controllers/clients.controller');
const { requireRole } = require('../middleware/auth');
const { ACCESS_MATRIX } = require('../constants/access-matrix');

const router = express.Router();
const viewClients = requireRole(...ACCESS_MATRIX.clientsView);
const manageClients = requireRole(...ACCESS_MATRIX.clientsManage);
const mergeClients = requireRole(...ACCESS_MATRIX.clientsMerge);

router.get('/clients', viewClients, clientsController.getAll);
router.get('/clients/lookup', viewClients, clientsController.lookup);
router.get('/clients/duplicates', mergeClients, clientsController.getDuplicates);
router.post('/clients', manageClients, clientsController.create);
router.get('/clients/:id', viewClients, clientsController.getOne);
router.put('/clients/:id', manageClients, clientsController.update);
router.delete(
  '/clients/:id/permanent',
  manageClients,
  clientsController.removeArchived,
);
router.post('/clients/:id/merge', mergeClients, clientsController.merge);

module.exports = router;
