const visitsAnalyticsService = require('../services/visits-analytics.service');
const clientBasesService = require('../services/client-bases.service');
const { sendError } = require('../utils/api-error');

class VisitsAnalyticsController {
  async getAnalytics(req, res) {
    try {
      const { from, to } = req.query;
      const analytics = await visitsAnalyticsService.getVisitsAnalytics(
        from,
        to,
      );
      res.json(analytics);
    } catch (error) {
      console.error('Ошибка аналитики визитов:', error);
      sendError(res, error, 'Ошибка аналитики визитов');
    }
  }

  async getSourceQuality(req, res) {
    try {
      const { from, to, sources } = req.query;
      res.json(await visitsAnalyticsService.getSourceQuality(from, to, { sourceKeys: sources ? String(sources).split(',') : undefined }));
    } catch (error) { sendError(res, error, 'Ошибка аналитики качества источников'); }
  }

  async getCohortsLifecycle(req, res) {
    try {
      const { from, to, sources } = req.query;
      res.json(await visitsAnalyticsService.getCohortsLifecycle(from, to, {
        sourceKeys: sources ? String(sources).split(',') : undefined,
      }));
    } catch (error) {
      sendError(res, error, 'Ошибка аналитики когорт и жизненного цикла');
    }
  }

  async getRevenueLtv(req, res) {
    try {
      const { from, to, sources } = req.query;
      res.json(await visitsAnalyticsService.getRevenueLtv(from, to, {
        sourceKeys: sources ? String(sources).split(',') : undefined,
      }));
    } catch (error) {
      sendError(res, error, 'Ошибка аналитики выручки и LTV');
    }
  }

  async previewClientBase(req, res) {
    try {
      res.json(await visitsAnalyticsService.previewVisitAnalyticsSegment(req.body));
    } catch (error) {
      sendError(res, error, 'Ошибка предпросмотра базы из аналитики');
    }
  }

  async createClientBase(req, res) {
    try {
      res.status(201).json(await clientBasesService.createFromVisitsAnalytics(
        req.account,
        req.body,
      ));
    } catch (error) {
      sendError(res, error, 'Ошибка создания базы из аналитики');
    }
  }

  async exportSourceQuality(req, res) {
    try {
      const { from, to, sources } = req.query;
      const buffer = await visitsAnalyticsService.createSourceQualityExportBuffer(from, to, { sourceKeys: sources ? String(sources).split(',') : undefined });
      res.setHeader('Content-Disposition', 'attachment; filename="visits_source_quality.xlsx"');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(buffer);
    } catch (error) { sendError(res, error, 'Ошибка экспорта качества источников'); }
  }

  async exportVisits(req, res) {
    try {
      const { from, to, sources } = req.query;
      const buffer = await visitsAnalyticsService.createVisitsExportBuffer(
        from,
        to,
        { sourceKeys: sources ? String(sources).split(',') : undefined },
      );

      res.setHeader(
        'Content-Disposition',
        'attachment; filename="visits_export.xlsx"',
      );
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.send(buffer);
    } catch (error) {
      console.error('Ошибка экспорта визитов:', error);
      sendError(res, error, 'Ошибка экспорта визитов');
    }
  }
}

module.exports = new VisitsAnalyticsController();
