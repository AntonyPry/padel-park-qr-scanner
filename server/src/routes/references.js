const express = require('express');
const referencesController = require('../controllers/references.controller');
const { requireRole } = require('../middleware/auth');
const { ACCESS_MATRIX } = require('../constants/access-matrix');

const router = express.Router();
const viewReferences = requireRole(...ACCESS_MATRIX.referencesView);
const manageReferences = requireRole(...ACCESS_MATRIX.referencesManage);

router.get('/references/:type', viewReferences, referencesController.list);
router.post('/references/:type', manageReferences, referencesController.create);
router.put('/references/:type/:id', manageReferences, referencesController.update);
router.post(
  '/references/:type/:id/archive',
  manageReferences,
  referencesController.archive,
);
router.post(
  '/references/:type/:id/restore',
  manageReferences,
  referencesController.restore,
);
router.delete(
  '/references/:type/:id/permanent',
  manageReferences,
  referencesController.removeArchived,
);

module.exports = router;
