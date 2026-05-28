const express = require('express');
const clientBasesController = require('../controllers/client-bases.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');

const router = express.Router();
const viewClientBases = requireRole(...ACCESS_MATRIX.clientBasesView);
const manageClientBases = requireRole(...ACCESS_MATRIX.clientBasesManage);

router.get('/client-bases', viewClientBases, validate({ query: apiSchemas.clientBases.listQuery }), clientBasesController.getAll);
router.post('/client-bases', manageClientBases, validate({ body: apiSchemas.clientBases.body }), clientBasesController.create);
router.get(
  '/client-bases/:id/clients',
  viewClientBases,
  validate({
    params: apiSchemas.clientBases.withId.params,
    query: apiSchemas.clients.listQuery,
  }),
  clientBasesController.getClients,
);
router.put('/client-bases/:id', manageClientBases, validate({ body: apiSchemas.clientBases.updateBody, params: apiSchemas.clientBases.withId.params }), clientBasesController.update);
router.delete(
  '/client-bases/:id',
  manageClientBases,
  validate({ params: apiSchemas.clientBases.withId.params }),
  clientBasesController.archive,
);
router.delete(
  '/client-bases/:id/permanent',
  manageClientBases,
  validate({ params: apiSchemas.clientBases.withId.params }),
  clientBasesController.removeArchived,
);
router.post(
  '/client-bases/:id/restore',
  manageClientBases,
  validate({ params: apiSchemas.clientBases.withId.params }),
  clientBasesController.restore,
);

module.exports = router;
