const express = require('express');
const callTasksController = require('../controllers/call-tasks.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');

const router = express.Router();
const manageCallTasks = requireRole(...ACCESS_MATRIX.callTasksManage);
const viewCallTasks = requireRole(...ACCESS_MATRIX.callTasksView);
const workCallTasks = requireRole(...ACCESS_MATRIX.callTasksWork);

router.post(
  '/client-bases/:baseId/call-tasks',
  manageCallTasks,
  validate(apiSchemas.callTasks.createFromBase),
  callTasksController.createFromBase,
);
router.post(
  '/clients/:clientId/call-tasks',
  manageCallTasks,
  validate(apiSchemas.callTasks.createForClient),
  callTasksController.createForClient,
);
router.get('/call-tasks', viewCallTasks, validate({ query: apiSchemas.callTasks.listQuery }), callTasksController.getAll);
router.get('/call-tasks/report', viewCallTasks, validate({ query: apiSchemas.callTasks.reportQuery }), callTasksController.getReport);
router.post(
  '/call-tasks/recurring/run',
  manageCallTasks,
  callTasksController.runRecurring,
);
router.get('/call-tasks/:id', viewCallTasks, validate(apiSchemas.callTasks.withId), callTasksController.getOne);
router.put('/call-tasks/:id', manageCallTasks, validate(apiSchemas.callTasks.update), callTasksController.update);
router.delete(
  '/call-tasks/:id/permanent',
  manageCallTasks,
  validate(apiSchemas.callTasks.withId),
  callTasksController.removeArchived,
);
router.post('/call-tasks/:id/sync', manageCallTasks, validate(apiSchemas.callTasks.withId), callTasksController.sync);
router.get(
  '/call-tasks/:id/clients',
  workCallTasks,
  validate({
    params: apiSchemas.callTasks.withId.params,
    query: apiSchemas.callTasks.clientsQuery,
  }),
  callTasksController.getClients,
);
router.patch(
  '/call-tasks/:id/clients/bulk',
  workCallTasks,
  validate(apiSchemas.callTasks.bulk),
  callTasksController.bulkUpdateClients,
);
router.post(
  '/call-task-clients/:taskClientId/attempts',
  workCallTasks,
  validate(apiSchemas.callTasks.attempt),
  callTasksController.addAttempt,
);

module.exports = router;
