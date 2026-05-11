const authService = require('../services/auth.service');

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.replace(/^Bearer\s+/i, '').trim();
    const payload = token ? authService.verifyToken(token) : null;

    if (!payload?.accountId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const account = await authService.getAccountById(payload.accountId);
    if (!account || account.status !== 'active') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    req.account = account;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.account || !roles.includes(req.account.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    next();
  };
}

module.exports = {
  requireAuth,
  requireRole,
};
