const { registerTypeScript } = require('../register-ts');

registerTypeScript();

module.exports = require('./auth.ts');
