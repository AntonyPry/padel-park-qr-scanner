function redactString(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/https?:\/\/[^\s'"<>]+/gi, '[redacted-url]')
    .replace(/(?<![A-Za-z0-9._-])\/(?:[^\s'"<>/]+\/)*[^\s'"<>/]+/g, '[redacted-path]')
    .replace(/\b[A-Za-z]:\\(?:[^\s'"<>\\]+\\)*[^\s'"<>\\]+/g, '[redacted-path]')
    .replace(/(?<!\w)(?:\+?7|8)[\s()\-]*\d(?:[\s()\-]*\d){9}(?!\d)/g, '[redacted-phone]');
}

function redactDetails(value, key = '') {
  const normalizedKey = String(key).toLowerCase();
  if (
    normalizedKey.includes('token') ||
    normalizedKey.includes('secret') ||
    normalizedKey === 'authorization'
  ) {
    return value ? '[redacted]' : value;
  }
  if (
    normalizedKey.includes('url') ||
    normalizedKey.includes('path') ||
    normalizedKey.includes('phone') ||
    normalizedKey.includes('rawtranscript') ||
    normalizedKey.includes('transcripttext')
  ) {
    return value ? '[redacted]' : value;
  }
  if (Array.isArray(value)) return value.map((item) => redactDetails(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, item]) => [childKey, redactDetails(item, childKey)]),
    );
  }
  return typeof value === 'string' ? redactString(value) : value;
}

function formatDetails(details) {
  if (!details || typeof details !== 'object') return '';
  return ` ${JSON.stringify(redactDetails(details))}`;
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
  redactDetails,
  redactString,
};
