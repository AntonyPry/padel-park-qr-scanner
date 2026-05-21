function sendError(res, error, fallback = 'Ошибка сервера') {
  const status = error?.statusCode || 500;
  const exposeMessage = status < 500;
  const payload = {
    error: exposeMessage ? error?.message || fallback : fallback,
    status,
  };

  if (error?.code) payload.code = error.code;
  if (error?.details) payload.details = error.details;
  if (error?.client) payload.client = error.client;

  res.status(status).json(payload);
}

module.exports = {
  sendError,
};
