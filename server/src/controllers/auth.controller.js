const authService = require('../services/auth.service');

class AuthController {
  async status(req, res) {
    res.json({ setupRequired: await authService.isSetupRequired() });
  }

  async bootstrap(req, res) {
    try {
      const { name, phone, email, password } = req.body;
      if (!name || !email || !password) {
        return res
          .status(400)
          .json({ error: 'Имя, email и пароль обязательны' });
      }

      const session = await authService.bootstrapOwner({
        name,
        phone,
        email,
        password,
      });
      res.json(session);
    } catch (error) {
      res
        .status(error.statusCode || 500)
        .json({ error: error.message || 'Ошибка настройки аккаунта' });
    }
  }

  async login(req, res) {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'Email и пароль обязательны' });
      }

      const session = await authService.login({ email, password });
      res.json(session);
    } catch (error) {
      res
        .status(error.statusCode || 500)
        .json({ error: error.message || 'Ошибка входа' });
    }
  }

  async me(req, res) {
    res.json({ account: authService.sanitizeAccount(req.account) });
  }
}

module.exports = new AuthController();
