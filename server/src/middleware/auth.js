const authService = require('../services/auth.service');
const { sendError } = require('../utils/api-error');

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.replace(/^Bearer\s+/i, '').trim();
    const payload = token ? authService.verifyToken(token) : null;

    if (!payload?.accountId) {
      return sendError(res, { statusCode: 401 }, 'Unauthorized');
    }

    const account = await authService.getAccountById(payload.accountId);
    if (
      !account ||
      account.status !== 'active' ||
      (account.Staff && account.Staff.status !== 'active')
    ) {
      return sendError(res, { statusCode: 401 }, 'Unauthorized');
    }

    req.account = account;
    next();
  } catch (error) {
    sendError(res, { statusCode: 401 }, 'Unauthorized');
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.account || !roles.includes(req.account.role)) {
      return sendError(res, { statusCode: 403 }, 'Forbidden');
    }

    next();
  };
}

module.exports = {
  requireAuth,
  requireRole,
};
