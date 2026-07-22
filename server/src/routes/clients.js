const express = require('express');
const clientsController = require('../controllers/clients.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');

const router = express.Router();
const viewClients = requireRole(...ACCESS_MATRIX.clientsView);
const viewClientRegistry = requireRole('owner', 'manager', 'viewer');
const searchOperationalClients = requireRole('owner', 'manager', 'admin', 'viewer', 'trainer');
const manageClients = requireRole(...ACCESS_MATRIX.clientsManage);
const mergeClients = requireRole(...ACCESS_MATRIX.clientsMerge);
const viewClientSkillMap = requireRole(...ACCESS_MATRIX.trainingNotesView);
const manageClientSkillMap = requireRole(...ACCESS_MATRIX.trainingNotesManage);

router.get('/clients', viewClientRegistry, validate({ query: apiSchemas.clients.listQuery }), clientsController.getAll);
router.get('/clients/search', searchOperationalClients, validate({ query: apiSchemas.clients.listQuery }), clientsController.getAll);
router.get('/clients/lookup', viewClients, validate({ query: apiSchemas.clients.lookupQuery }), clientsController.lookup);
router.get('/clients/duplicates', mergeClients, clientsController.getDuplicates);
router.get('/clients/views', viewClientRegistry, clientsController.getSavedViews);
router.post('/clients/views', viewClientRegistry, validate({ body: apiSchemas.clients.savedViewBody }), clientsController.createSavedView);
router.put('/clients/views/:viewId', viewClientRegistry, validate({ body: apiSchemas.clients.savedViewUpdateBody, params: apiSchemas.clients.viewParams }), clientsController.updateSavedView);
router.delete('/clients/views/:viewId', viewClientRegistry, validate({ params: apiSchemas.clients.viewParams }), clientsController.deleteSavedView);
router.post('/clients', manageClients, validate({ body: apiSchemas.clients.body }), clientsController.create);
router.post(
  '/clients/training-recommendation/group',
  viewClientSkillMap,
  validate({ body: apiSchemas.clients.groupTrainingRecommendationBody }),
  clientsController.getGroupTrainingRecommendation,
);
router.get(
  '/clients/:clientId/training-recommendation',
  viewClientSkillMap,
  validate({
    params: apiSchemas.clients.skillMapParams,
    query: apiSchemas.clients.trainingRecommendationQuery,
  }),
  clientsController.getTrainingRecommendation,
);
router.get('/clients/:clientId/skill-map', viewClientSkillMap, validate({ params: apiSchemas.clients.skillMapParams }), clientsController.getSkillMap);
router.put('/clients/:clientId/skill-map/:skillId', manageClientSkillMap, validate({ body: apiSchemas.clients.skillMapUpdateBody, params: apiSchemas.clients.skillMapEntryParams }), clientsController.updateSkillMap);
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
