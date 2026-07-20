'use strict';

const authenticatedContexts = new WeakSet();

function createAuthenticatedIngressContext(connection) {
  const context = Object.freeze({ connection });
  authenticatedContexts.add(context);
  return context;
}

function requireAuthenticatedIngressContext(context, provider) {
  if (
    !context ||
    !authenticatedContexts.has(context) ||
    context.connection?.provider !== provider
  ) {
    const error = new Error('Provider ingress authentication is required');
    error.code = 'PROVIDER_INGRESS_AUTHENTICATION_REQUIRED';
    error.statusCode = 404;
    throw error;
  }
  return context.connection;
}

module.exports = {
  createAuthenticatedIngressContext,
  requireAuthenticatedIngressContext,
};
