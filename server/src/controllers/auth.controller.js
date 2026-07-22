const authService = require('../services/auth.service');
const tenantContextService = require('../services/tenant-context.service');
const { disconnectSessionSockets } = require('../realtime/session-boundary');
const { sendError } = require('../utils/api-error');
const {
  clearBrowserSessionCookies,
  setBrowserSessionCookies,
  shouldExposeBearerResponse,
} = require('../security/browser-session');

function sendSession(res, req, session) {
  setBrowserSessionCookies(res, session.token);
  const response = {
    account: session.account,
    capabilities: session.capabilities,
  };
  if (shouldExposeBearerResponse(req)) response.token = session.token;
  return res.json(response);
}

class AuthController {
  async status(req, res) {
    try {
      res.json(await authService.getSetupStatus());
    } catch (error) {
      sendError(res, error, 'Ошибка проверки состояния системы');
    }
  }

  async bootstrap(req, res) {
    try {
      const { name, phone, email, password } = req.body;
      if (!name || !email || !password) {
        return sendError(
          res,
          { statusCode: 400 },
          'Имя, email и пароль обязательны',
        );
      }

      const session = await authService.bootstrapOwner({
        name,
        phone,
        email,
        password,
      });
      const onTenantInitialized = req.app.get('onTenantInitialized');
      if (typeof onTenantInitialized === 'function') {
        await onTenantInitialized();
      }
      sendSession(res, req, session);
    } catch (error) {
      sendError(res, error, 'Ошибка настройки аккаунта');
    }
  }

  async login(req, res) {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return sendError(res, { statusCode: 400 }, 'Email и пароль обязательны');
      }

      const session = await authService.login({ email, password });
      sendSession(res, req, session);
    } catch (error) {
      sendError(res, error, 'Ошибка входа');
    }
  }

  async logout(req, res) {
    try {
      const revoked = await authService.revokeCurrentSession(
        authService.extractSessionToken(req),
      );
      if (revoked?.sessionId) {
        disconnectSessionSockets(req.app.get('io'), revoked.sessionId);
      }
      clearBrowserSessionCookies(res);
      res.json({ success: true });
    } catch (_error) {
      sendError(
        res,
        { statusCode: 503 },
        'Не удалось завершить сессию',
      );
    }
  }

  async me(req, res) {
    res.json({ account: authService.sanitizeAccount(req.account) });
  }

  async memberships(req, res) {
    try {
      res.json(await tenantContextService.discoverMemberships(req.account.id));
    } catch (error) {
      sendError(res, error, 'Не удалось загрузить доступные организации и клубы');
    }
  }
}

module.exports = new AuthController();
