'use strict';

function disconnectMatchingSockets(io, predicate) {
  if (!io?.sockets?.sockets) return 0;
  let disconnected = 0;
  for (const socket of io.sockets.sockets.values()) {
    if (!predicate(socket.data || {})) continue;
    socket.disconnect(true);
    disconnected += 1;
  }
  return disconnected;
}

function disconnectAccountSockets(io, accountId) {
  return disconnectMatchingSockets(
    io,
    (data) => Number(data.account?.id) === Number(accountId),
  );
}

function disconnectAccountSocketsExceptSession(io, accountId, sessionId) {
  return disconnectMatchingSockets(
    io,
    (data) =>
      Number(data.account?.id) === Number(accountId) &&
      data.authentication?.sessionId !== sessionId,
  );
}

function disconnectSessionSockets(io, sessionId) {
  if (!sessionId) return 0;
  return disconnectMatchingSockets(
    io,
    (data) => data.authentication?.sessionId === sessionId,
  );
}

function disconnectStaffSockets(io, staffId) {
  return disconnectMatchingSockets(
    io,
    (data) => Number(data.account?.staffId) === Number(staffId),
  );
}

module.exports = {
  disconnectAccountSockets,
  disconnectAccountSocketsExceptSession,
  disconnectSessionSockets,
  disconnectStaffSockets,
  _private: { disconnectMatchingSockets },
};
