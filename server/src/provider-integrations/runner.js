'use strict';

function publicConnectionIdentity(connection) {
  return {
    clubId: connection.clubId,
    connectionPublicId: connection.publicId,
    organizationId: connection.organizationId,
  };
}

async function runIsolatedProviderConnections(
  connections,
  task,
  { failureMessage = 'Provider connection task failed' } = {},
) {
  return Promise.all(connections.map(async (connection) => {
    try {
      return {
        ...publicConnectionIdentity(connection),
        ...(await task(connection)),
      };
    } catch {
      return {
        action: 'failed',
        ...publicConnectionIdentity(connection),
        error: failureMessage,
      };
    }
  }));
}

module.exports = {
  publicConnectionIdentity,
  runIsolatedProviderConnections,
};
