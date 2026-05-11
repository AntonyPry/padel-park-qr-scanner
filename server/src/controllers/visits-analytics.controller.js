const visitsAnalyticsService = require('../services/visits-analytics.service');

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
      res.status(500).json({ error: 'Server error' });
    }
  }

  async exportVisits(req, res) {
    try {
      const { from, to } = req.query;
      const buffer = await visitsAnalyticsService.createVisitsExportBuffer(
        from,
        to,
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
      res.status(500).send('Export error');
    }
  }
}

module.exports = new VisitsAnalyticsController();
