'use strict';

const shiftReportsService = require('../services/shift-reports.service');
const { sendError } = require('../utils/api-error');

class ShiftReportsController {
  async listTemplates(req, res) {
    try {
      res.json(
        await shiftReportsService.listTemplates(req.query, req.account, req.tenant),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка загрузки шаблонов отчетов смены');
    }
  }

  async createTemplate(req, res) {
    try {
      const template = await shiftReportsService.createTemplate(
        req.body,
        req.account,
        req.tenant,
      );
      res.status(201).json(template);
    } catch (error) {
      sendError(res, error, 'Ошибка создания шаблона отчета');
    }
  }

  async updateTemplate(req, res) {
    try {
      res.json(
        await shiftReportsService.updateTemplate(
          req.params.id,
          req.body,
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка обновления шаблона отчета');
    }
  }

  async archiveTemplate(req, res) {
    try {
      res.json(
        await shiftReportsService.setTemplateStatus(
          req.params.id,
          'archived',
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка архивирования шаблона отчета');
    }
  }

  async restoreTemplate(req, res) {
    try {
      res.json(
        await shiftReportsService.setTemplateStatus(
          req.params.id,
          'active',
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка восстановления шаблона отчета');
    }
  }

  async createTemplateItem(req, res) {
    try {
      const template = await shiftReportsService.createTemplateItem(
        req.params.templateId,
        req.body,
        req.account,
        req.tenant,
      );
      res.status(201).json(template);
    } catch (error) {
      sendError(res, error, 'Ошибка создания пункта отчета');
    }
  }

  async updateTemplateItem(req, res) {
    try {
      res.json(
        await shiftReportsService.updateTemplateItem(
          req.params.id,
          req.body,
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка обновления пункта отчета');
    }
  }

  async archiveTemplateItem(req, res) {
    try {
      res.json(
        await shiftReportsService.setTemplateItemStatus(
          req.params.id,
          'archived',
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка архивирования пункта отчета');
    }
  }

  async restoreTemplateItem(req, res) {
    try {
      res.json(
        await shiftReportsService.setTemplateItemStatus(
          req.params.id,
          'active',
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка восстановления пункта отчета');
    }
  }

  async getActiveShiftReports(req, res) {
    try {
      res.json(
        await shiftReportsService.getActiveShiftReports(req.account, req.tenant),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка загрузки отчетов активной смены');
    }
  }

  async listReports(req, res) {
    try {
      res.json(
        await shiftReportsService.listReports(req.query, req.account, req.tenant),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка загрузки отчетов смены');
    }
  }

  async getReport(req, res) {
    try {
      res.json(
        await shiftReportsService.getReport(req.params.id, req.account, req.tenant),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка загрузки отчета смены');
    }
  }

  async saveDraft(req, res) {
    try {
      res.json(
        await shiftReportsService.saveReport(req.params.id, req.body, req.account, {
          submit: false,
          tenant: req.tenant,
        }),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка сохранения черновика отчета');
    }
  }

  async submitReport(req, res) {
    try {
      res.json(
        await shiftReportsService.saveReport(req.params.id, req.body, req.account, {
          submit: true,
          tenant: req.tenant,
        }),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка сдачи отчета смены');
    }
  }

  async uploadAttachment(req, res) {
    try {
      res.status(201).json(
        await shiftReportsService.uploadAttachment(
          req.params.reportId,
          req.params.answerId,
          req.body,
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка загрузки фото отчета');
    }
  }

  async removeAttachment(req, res) {
    try {
      res.json(
        await shiftReportsService.removeAttachment(
          req.params.reportId,
          req.params.answerId,
          req.params.attachmentId,
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка удаления фото отчета');
    }
  }

  async getAttachment(req, res) {
    try {
      const { absolutePath, attachment } = await shiftReportsService.getAttachment(
        req.params.reportId,
        req.params.answerId,
        req.params.attachmentId,
        req.account,
        req.tenant,
      );
      res.setHeader('Content-Type', attachment.mimeType);
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(attachment.originalName || 'photo')}"`,
      );
      res.sendFile(absolutePath);
    } catch (error) {
      sendError(res, error, 'Ошибка открытия фото отчета');
    }
  }
}

module.exports = new ShiftReportsController();
