const express = require('express');
const router = express.Router();
const certificatesController = require('../controllers/certificates.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');

const viewCertificates = requireRole(...ACCESS_MATRIX.certificatesView);
const redeemCertificates = requireRole(...ACCESS_MATRIX.certificatesRedeem);

router.get(
  '/certificates',
  viewCertificates,
  validate({ query: apiSchemas.certificates.listQuery }),
  certificatesController.list,
);
router.get(
  '/clients/:clientId/certificates',
  viewCertificates,
  validate({
    params: apiSchemas.certificates.clientParams,
    query: apiSchemas.certificates.clientListQuery,
  }),
  certificatesController.listClientCertificates,
);
router.post(
  '/clients/:clientId/certificates',
  redeemCertificates,
  validate({
    body: apiSchemas.certificates.manualIssueBody,
    params: apiSchemas.certificates.clientParams,
  }),
  certificatesController.issue,
);
router.get(
  '/certificates/:id',
  viewCertificates,
  validate(apiSchemas.certificates.withId),
  certificatesController.get,
);
router.get(
  '/certificates/:id/redemptions',
  viewCertificates,
  validate(apiSchemas.certificates.withId),
  certificatesController.listRedemptions,
);
router.post(
  '/certificates/:id/redemptions',
  redeemCertificates,
  validate({
    body: apiSchemas.certificates.redemptionBody,
    params: apiSchemas.certificates.withId.params,
  }),
  certificatesController.redeem,
);
router.post(
  '/certificates/:id/redemptions/:redemptionId/reverse',
  redeemCertificates,
  validate(apiSchemas.certificates.redemptionReverse),
  certificatesController.reverseRedemption,
);

module.exports = router;
