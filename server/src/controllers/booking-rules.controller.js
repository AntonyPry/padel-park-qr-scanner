const bookingRulesService = require('../services/booking-rules.service');

function send(res, data, status = 200) {
  res.status(status).json(data);
}

async function getSettings(req, res, next) {
  try {
    send(res, await bookingRulesService.getSettings());
  } catch (error) {
    next(error);
  }
}

async function updateSettings(req, res, next) {
  try {
    send(res, await bookingRulesService.updateSettings(req.body));
  } catch (error) {
    next(error);
  }
}

async function quote(req, res, next) {
  try {
    send(res, await bookingRulesService.calculateQuote(req.query));
  } catch (error) {
    next(error);
  }
}

async function listPriceRules(req, res, next) {
  try {
    send(res, await bookingRulesService.listPriceRules(req.query.status || 'active'));
  } catch (error) {
    next(error);
  }
}

async function createPriceRule(req, res, next) {
  try {
    send(res, await bookingRulesService.createPriceRule(req.body), 201);
  } catch (error) {
    next(error);
  }
}

async function updatePriceRule(req, res, next) {
  try {
    send(res, await bookingRulesService.updatePriceRule(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
}

async function archivePriceRule(req, res, next) {
  try {
    send(res, await bookingRulesService.archivePriceRule(req.params.id));
  } catch (error) {
    next(error);
  }
}

async function listBlocks(req, res, next) {
  try {
    send(res, await bookingRulesService.listBlocks(req.query));
  } catch (error) {
    next(error);
  }
}

async function createBlock(req, res, next) {
  try {
    send(res, await bookingRulesService.createBlock(req.body, req.account), 201);
  } catch (error) {
    next(error);
  }
}

async function updateBlock(req, res, next) {
  try {
    send(res, await bookingRulesService.updateBlock(req.params.id, req.body, req.account));
  } catch (error) {
    next(error);
  }
}

async function archiveBlock(req, res, next) {
  try {
    send(res, await bookingRulesService.archiveBlock(req.params.id, req.account));
  } catch (error) {
    next(error);
  }
}

async function listExceptions(req, res, next) {
  try {
    send(res, await bookingRulesService.listExceptions(req.query.status || 'active'));
  } catch (error) {
    next(error);
  }
}

async function upsertException(req, res, next) {
  try {
    send(res, await bookingRulesService.upsertException(req.body), 201);
  } catch (error) {
    next(error);
  }
}

async function updateException(req, res, next) {
  try {
    send(res, await bookingRulesService.updateException(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
}

async function archiveException(req, res, next) {
  try {
    send(res, await bookingRulesService.archiveException(req.params.id));
  } catch (error) {
    next(error);
  }
}

module.exports = {
  archiveBlock,
  archiveException,
  archivePriceRule,
  createBlock,
  createPriceRule,
  getSettings,
  listBlocks,
  listExceptions,
  listPriceRules,
  quote,
  updateBlock,
  updateException,
  updatePriceRule,
  updateSettings,
  upsertException,
};
