const authService = require('../services/auth.service');
const { sendError } = require('../utils/api-error');

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
      res.json(session);
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
      res.json(session);
    } catch (error) {
      sendError(res, error, 'Ошибка входа');
    }
  }

  async me(req, res) {
    res.json({ account: authService.sanitizeAccount(req.account) });
  }
}

module.exports = new AuthController();
