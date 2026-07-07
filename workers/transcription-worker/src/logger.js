function formatDetails(details) {
  if (!details || typeof details !== 'object') return '';
  return ` ${JSON.stringify(details)}`;
}

function createLogger() {
  const write = (level, message, details) => {
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${formatDetails(details)}`;
    if (level === 'error') {
      console.error(line);
    } else {
      console.log(line);
    }
  };

  return {
    debug: (message, details) => write('debug', message, details),
    error: (message, details) => write('error', message, details),
    info: (message, details) => write('info', message, details),
    warn: (message, details) => write('warn', message, details),
  };
}

module.exports = {
  createLogger,
};
