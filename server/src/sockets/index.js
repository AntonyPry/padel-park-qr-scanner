const { Server } = require('socket.io');
const authService = require('../services/auth.service');
const { ACCESS_MATRIX } = require('../constants/access-matrix');

const ACCESS_SOCKET_ROOM = 'access';

function parseAllowedOrigin(value) {
  if (!value || value === '*') return value || '*';

  const origins = String(value)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) return '*';
  return origins.length === 1 ? origins[0] : origins;
}

function createSocketServer(httpServer) {
  const allowedOrigin = parseAllowedOrigin(
    process.env.CLIENT_ORIGIN || process.env.CORS_ORIGIN,
  );
  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigin,
      methods: ['GET', 'POST'],
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = String(socket.handshake.auth?.token || '').trim();
      const payload = token ? authService.verifyToken(token) : null;
      if (!payload?.accountId) return next(new Error('Unauthorized'));

      const account = await authService.getAccountById(payload.accountId);
      if (
        !account ||
        account.status !== 'active' ||
        (account.Staff && account.Staff.status !== 'active')
      ) {
        return next(new Error('Unauthorized'));
      }
      if (!ACCESS_MATRIX.accessOperate.includes(account.role)) {
        return next(new Error('Forbidden'));
      }

      socket.data.account = account;
      return next();
    } catch {
      return next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(ACCESS_SOCKET_ROOM);
  });

  return io;
}

module.exports = {
  ACCESS_SOCKET_ROOM,
  createSocketServer,
};
