const express = require('express');
const clientBasesController = require('../controllers/client-bases.controller');
const { requireRole } = require('../middleware/auth');
const { ACCESS_MATRIX } = require('../constants/access-matrix');

const router = express.Router();
const viewClientBases = requireRole(...ACCESS_MATRIX.clientBasesView);
const manageClientBases = requireRole(...ACCESS_MATRIX.clientBasesManage);

router.get('/client-bases', viewClientBases, clientBasesController.getAll);
router.post('/client-bases', manageClientBases, clientBasesController.create);
router.get(
  '/client-bases/:id/clients',
  viewClientBases,
  clientBasesController.getClients,
);
router.put('/client-bases/:id', manageClientBases, clientBasesController.update);
router.delete(
  '/client-bases/:id',
  manageClientBases,
  clientBasesController.archive,
);
router.delete(
  '/client-bases/:id/permanent',
  manageClientBases,
  clientBasesController.removeArchived,
);
router.post(
  '/client-bases/:id/restore',
  manageClientBases,
  clientBasesController.restore,
);

module.exports = router;
