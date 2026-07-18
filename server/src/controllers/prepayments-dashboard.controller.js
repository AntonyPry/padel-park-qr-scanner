const prepaymentsDashboardService = require('../services/prepayments-dashboard.service');
const { sendError } = require('../utils/api-error');

class PrepaymentsDashboardController {
  async getDashboard(req, res) {
    try {
      res.json(
        await prepaymentsDashboardService.getDashboard(
          req.query,
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка сводки предоплат и списаний');
    }
  }
}

module.exports = new PrepaymentsDashboardController();
