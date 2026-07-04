'use strict';

const express = require('express');
const shiftReportsController = require('../controllers/shift-reports.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');

const router = express.Router();
const viewReports = requireRole(...ACCESS_MATRIX.shiftReportsView);
const submitReports = requireRole(...ACCESS_MATRIX.shiftReportsSubmit);
const manageTemplates = requireRole(...ACCESS_MATRIX.shiftReportTemplatesManage);

router.get(
  '/shift-report-templates',
  viewReports,
  validate({ query: apiSchemas.shiftReports.templateListQuery }),
  shiftReportsController.listTemplates,
);
router.post(
  '/shift-report-templates',
  manageTemplates,
  validate({ body: apiSchemas.shiftReports.templateBody }),
  shiftReportsController.createTemplate,
);
router.put(
  '/shift-report-templates/:id',
  manageTemplates,
  validate({
    body: apiSchemas.shiftReports.templateUpdateBody,
    params: apiSchemas.shiftReports.withId.params,
  }),
  shiftReportsController.updateTemplate,
);
router.post(
  '/shift-report-templates/:id/archive',
  manageTemplates,
  validate({ params: apiSchemas.shiftReports.withId.params }),
  shiftReportsController.archiveTemplate,
);
router.post(
  '/shift-report-templates/:id/restore',
  manageTemplates,
  validate({ params: apiSchemas.shiftReports.withId.params }),
  shiftReportsController.restoreTemplate,
);
router.post(
  '/shift-report-templates/:templateId/items',
  manageTemplates,
  validate({
    body: apiSchemas.shiftReports.templateItemBody,
    params: apiSchemas.shiftReports.templateItemCreateParams,
  }),
  shiftReportsController.createTemplateItem,
);
router.put(
  '/shift-report-template-items/:id',
  manageTemplates,
  validate({
    body: apiSchemas.shiftReports.templateItemUpdateBody,
    params: apiSchemas.shiftReports.withId.params,
  }),
  shiftReportsController.updateTemplateItem,
);
router.post(
  '/shift-report-template-items/:id/archive',
  manageTemplates,
  validate({ params: apiSchemas.shiftReports.withId.params }),
  shiftReportsController.archiveTemplateItem,
);
router.post(
  '/shift-report-template-items/:id/restore',
  manageTemplates,
  validate({ params: apiSchemas.shiftReports.withId.params }),
  shiftReportsController.restoreTemplateItem,
);

router.get(
  '/shifts/active/reports',
  submitReports,
  shiftReportsController.getActiveShiftReports,
);
router.get(
  '/shift-reports',
  viewReports,
  validate({ query: apiSchemas.shiftReports.reportListQuery }),
  shiftReportsController.listReports,
);
router.get(
  '/shift-reports/:id',
  viewReports,
  validate({ params: apiSchemas.shiftReports.withId.params }),
  shiftReportsController.getReport,
);
router.put(
  '/shift-reports/:id/draft',
  submitReports,
  validate({
    body: apiSchemas.shiftReports.reportSaveBody,
    params: apiSchemas.shiftReports.withId.params,
  }),
  shiftReportsController.saveDraft,
);
router.post(
  '/shift-reports/:id/submit',
  submitReports,
  validate({
    body: apiSchemas.shiftReports.reportSaveBody,
    params: apiSchemas.shiftReports.withId.params,
  }),
  shiftReportsController.submitReport,
);
router.post(
  '/shift-reports/:reportId/answers/:answerId/attachments',
  submitReports,
  validate({
    body: apiSchemas.shiftReports.attachmentBody,
    params: apiSchemas.shiftReports.attachmentParams,
  }),
  shiftReportsController.uploadAttachment,
);
router.delete(
  '/shift-reports/:reportId/answers/:answerId/attachments/:attachmentId',
  submitReports,
  validate({ params: apiSchemas.shiftReports.attachmentDeleteParams }),
  shiftReportsController.removeAttachment,
);
router.get(
  '/shift-reports/:reportId/answers/:answerId/attachments/:attachmentId',
  viewReports,
  validate({ params: apiSchemas.shiftReports.attachmentDeleteParams }),
  shiftReportsController.getAttachment,
);

module.exports = router;
