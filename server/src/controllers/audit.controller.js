const auditService = require('../services/audit.service');
const { sendError } = require('../utils/api-error');

class AuditController {
  async getAll(req, res) {
    try {
      res.json(await auditService.list(req.query, req.account, req.tenant));
    } catch (error) {
      sendError(res, error, 'Ошибка получения журнала действий');
    }
  }
}

module.exports = new AuditController();
