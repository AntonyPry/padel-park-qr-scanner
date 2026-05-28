const { registerTypeScript } = require('../register-ts');

registerTypeScript();

module.exports = require('./cache.service.ts');
