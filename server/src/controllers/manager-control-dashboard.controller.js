const managerControlDashboardService = require('../services/manager-control-dashboard.service');
const { sendError } = require('../utils/api-error');

class ManagerControlDashboardController {
  async getDashboard(req, res) {
    try {
      res.json(
        await managerControlDashboardService.getDashboard(
          req.query,
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка дашборда менеджера');
    }
  }
}

module.exports = new ManagerControlDashboardController();
