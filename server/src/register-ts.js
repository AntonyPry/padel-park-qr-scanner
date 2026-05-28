let registered = false;

function registerTypeScript() {
  if (registered) return;

  try {
    require('tsx/cjs');
    registered = true;
  } catch (error) {
    error.message = `Не удалось зарегистрировать TypeScript runtime для backend: ${error.message}`;
    throw error;
  }
}

module.exports = {
  registerTypeScript,
};
