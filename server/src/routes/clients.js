const express = require('express');
const clientsController = require('../controllers/clients.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');

const router = express.Router();
const viewClients = requireRole(...ACCESS_MATRIX.clientsView);
const manageClients = requireRole(...ACCESS_MATRIX.clientsManage);
const mergeClients = requireRole(...ACCESS_MATRIX.clientsMerge);

router.get('/clients', viewClients, validate({ query: apiSchemas.clients.listQuery }), clientsController.getAll);
router.get('/clients/lookup', viewClients, validate({ query: apiSchemas.clients.lookupQuery }), clientsController.lookup);
router.get('/clients/duplicates', mergeClients, clientsController.getDuplicates);
router.get('/clients/views', viewClients, clientsController.getSavedViews);
router.post('/clients/views', viewClients, validate({ body: apiSchemas.clients.savedViewBody }), clientsController.createSavedView);
router.put('/clients/views/:viewId', viewClients, validate({ body: apiSchemas.clients.savedViewUpdateBody, params: apiSchemas.clients.viewParams }), clientsController.updateSavedView);
router.delete('/clients/views/:viewId', viewClients, validate({ params: apiSchemas.clients.viewParams }), clientsController.deleteSavedView);
router.post('/clients', manageClients, validate({ body: apiSchemas.clients.body }), clientsController.create);
router.get('/clients/:id', viewClients, validate({ params: apiSchemas.clients.params }), clientsController.getOne);
router.put('/clients/:id', manageClients, validate({ body: apiSchemas.clients.updateBody, params: apiSchemas.clients.params }), clientsController.update);
router.delete(
  '/clients/:id/permanent',
  manageClients,
  validate({ params: apiSchemas.clients.params }),
  clientsController.removeArchived,
);
router.post('/clients/:id/merge', mergeClients, validate({ body: apiSchemas.clients.mergeBody, params: apiSchemas.clients.params }), clientsController.merge);

module.exports = router;
