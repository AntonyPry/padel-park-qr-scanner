const express = require('express');
const referencesController = require('../controllers/references.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');

const router = express.Router();
const viewReferences = requireRole(...ACCESS_MATRIX.referencesView);
const manageReferences = requireRole(...ACCESS_MATRIX.referencesManage);

router.get('/references/:type', viewReferences, validate({ params: apiSchemas.references.typeParams, query: apiSchemas.references.listQuery }), referencesController.list);
router.post('/references/:type', manageReferences, validate({ body: apiSchemas.references.body, params: apiSchemas.references.typeParams }), referencesController.create);
router.put('/references/:type/:id', manageReferences, validate({ body: apiSchemas.references.updateBody, params: apiSchemas.references.params }), referencesController.update);
router.post(
  '/references/:type/:id/archive',
  manageReferences,
  validate({ params: apiSchemas.references.params }),
  referencesController.archive,
);
router.post(
  '/references/:type/:id/restore',
  manageReferences,
  validate({ params: apiSchemas.references.params }),
  referencesController.restore,
);
router.delete(
  '/references/:type/:id/permanent',
  manageReferences,
  validate({ params: apiSchemas.references.params }),
  referencesController.removeArchived,
);

module.exports = router;
