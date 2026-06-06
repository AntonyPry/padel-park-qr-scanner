const express = require('express');
const router = express.Router();
const corporateClientsController = require('../controllers/corporate-clients.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');

const viewCorporateClients = requireRole(...ACCESS_MATRIX.corporateClientsView);
const manageCorporateDeposits = requireRole(
  ...ACCESS_MATRIX.corporateDepositsManage,
);
const exportCorporateLedger = requireRole(...ACCESS_MATRIX.financeExport);

router.get(
  '/corporate-clients',
  viewCorporateClients,
  validate({ query: apiSchemas.corporateClients.listQuery }),
  corporateClientsController.list,
);
router.post(
  '/corporate-clients',
  manageCorporateDeposits,
  validate({ body: apiSchemas.corporateClients.body }),
  corporateClientsController.create,
);
router.get(
  '/corporate-clients/:id',
  viewCorporateClients,
  validate(apiSchemas.corporateClients.withId),
  corporateClientsController.get,
);
router.put(
  '/corporate-clients/:id',
  manageCorporateDeposits,
  validate({
    body: apiSchemas.corporateClients.updateBody,
    params: apiSchemas.corporateClients.withId.params,
  }),
  corporateClientsController.update,
);
router.post(
  '/corporate-clients/:id/archive',
  manageCorporateDeposits,
  validate({
    body: apiSchemas.corporateClients.reasonBody,
    params: apiSchemas.corporateClients.withId.params,
  }),
  corporateClientsController.archive,
);
router.post(
  '/corporate-clients/:id/restore',
  manageCorporateDeposits,
  validate(apiSchemas.corporateClients.withId),
  corporateClientsController.restore,
);
router.get(
  '/corporate-clients/:id/ledger',
  viewCorporateClients,
  validate({
    params: apiSchemas.corporateClients.withId.params,
    query: apiSchemas.corporateClients.ledgerQuery,
  }),
  corporateClientsController.listLedger,
);
router.get(
  '/corporate-clients/:id/ledger/export',
  exportCorporateLedger,
  validate({
    params: apiSchemas.corporateClients.withId.params,
    query: apiSchemas.corporateClients.ledgerQuery,
  }),
  corporateClientsController.exportLedger,
);
router.post(
  '/corporate-clients/:id/deposits',
  manageCorporateDeposits,
  validate({
    body: apiSchemas.corporateClients.depositBody,
    params: apiSchemas.corporateClients.withId.params,
  }),
  corporateClientsController.createDeposit,
);
router.post(
  '/corporate-clients/:id/deposits/:entryId/cancel',
  manageCorporateDeposits,
  validate({
    body: apiSchemas.corporateClients.reasonBody,
    params: apiSchemas.corporateClients.entryParams,
  }),
  corporateClientsController.cancelDeposit,
);
router.post(
  '/corporate-clients/:id/spendings',
  manageCorporateDeposits,
  validate({
    body: apiSchemas.corporateClients.spendingBody,
    params: apiSchemas.corporateClients.withId.params,
  }),
  corporateClientsController.createSpending,
);
router.post(
  '/corporate-clients/:id/spendings/:entryId/reverse',
  manageCorporateDeposits,
  validate({
    body: apiSchemas.corporateClients.reasonBody,
    params: apiSchemas.corporateClients.entryParams,
  }),
  corporateClientsController.reverseSpending,
);

module.exports = router;
