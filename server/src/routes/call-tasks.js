const express = require('express');
const callTasksController = require('../controllers/call-tasks.controller');
const { requireRole } = require('../middleware/auth');
const { ACCESS_MATRIX } = require('../constants/access-matrix');

const router = express.Router();
const manageCallTasks = requireRole(...ACCESS_MATRIX.callTasksManage);
const viewCallTasks = requireRole(...ACCESS_MATRIX.callTasksView);
const workCallTasks = requireRole(...ACCESS_MATRIX.callTasksWork);

router.post(
  '/client-bases/:baseId/call-tasks',
  manageCallTasks,
  callTasksController.createFromBase,
);
router.get('/call-tasks', viewCallTasks, callTasksController.getAll);
router.post(
  '/call-tasks/recurring/run',
  manageCallTasks,
  callTasksController.runRecurring,
);
router.get('/call-tasks/:id', viewCallTasks, callTasksController.getOne);
router.put('/call-tasks/:id', manageCallTasks, callTasksController.update);
router.delete(
  '/call-tasks/:id/permanent',
  manageCallTasks,
  callTasksController.removeArchived,
);
router.post('/call-tasks/:id/sync', manageCallTasks, callTasksController.sync);
router.get(
  '/call-tasks/:id/clients',
  workCallTasks,
  callTasksController.getClients,
);
router.post(
  '/call-task-clients/:taskClientId/attempts',
  workCallTasks,
  callTasksController.addAttempt,
);

module.exports = router;
