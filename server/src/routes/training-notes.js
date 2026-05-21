const express = require('express');
const trainingNotesController = require('../controllers/training-notes.controller');
const { requireRole } = require('../middleware/auth');
const { ACCESS_MATRIX } = require('../constants/access-matrix');

const router = express.Router();
const viewTrainingNotes = requireRole(...ACCESS_MATRIX.trainingNotesView);
const manageTrainingNotes = requireRole(...ACCESS_MATRIX.trainingNotesManage);

router.get(
  '/clients/:clientId/training-notes',
  viewTrainingNotes,
  trainingNotesController.getByClient,
);
router.post(
  '/clients/:clientId/training-notes',
  manageTrainingNotes,
  trainingNotesController.create,
);

module.exports = router;
