const certificatesService = require('../services/certificates.service');
const { sendError } = require('../utils/api-error');

function handleError(res, error, fallback) {
  sendError(res, error, fallback);
}

class CertificatesController {
  async list(req, res) {
    try {
      res.json(await certificatesService.listCertificates(req.query, req.tenant));
    } catch (error) {
      handleError(res, error, 'Ошибка поиска сертификатов');
    }
  }

  async listClientCertificates(req, res) {
    try {
      res.json(
        await certificatesService.listClientCertificates(
          req.params.clientId,
          req.query,
          req.tenant,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка получения сертификатов клиента');
    }
  }

  async get(req, res) {
    try {
      res.json(await certificatesService.getCertificate(req.params.id, req.tenant));
    } catch (error) {
      handleError(res, error, 'Ошибка получения сертификата');
    }
  }

  async listRedemptions(req, res) {
    try {
      res.json(
        await certificatesService.listCertificateRedemptions(
          req.params.id,
          req.tenant,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка получения истории сертификата');
    }
  }

  async redeem(req, res) {
    try {
      res.status(201).json(
        await certificatesService.redeemCertificate(
          req.params.id,
          req.body,
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка списания сертификата');
    }
  }

  async reverseRedemption(req, res) {
    try {
      res.json(
        await certificatesService.reverseCertificateRedemption(
          req.params.id,
          req.params.redemptionId,
          req.body,
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка отмены списания сертификата');
    }
  }
}

module.exports = new CertificatesController();
