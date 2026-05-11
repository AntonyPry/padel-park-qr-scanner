const { Server } = require('socket.io');

function createSocketServer(httpServer) {
  return new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });
}

module.exports = {
  createSocketServer,
};
