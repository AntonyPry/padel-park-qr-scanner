const telephonyService = require('../services/telephony.service');
const { sendError } = require('../utils/api-error');

function handleError(res, error, fallback) {
  sendError(res, error, fallback);
}

class TelephonyController {
  async receiveBeelineEvent(req, res) {
    try {
      res.status(200).json(
        await telephonyService.receiveBeelineEvent({
          body: req.body,
          headers: req.headers,
          ip: req.ip,
          query: req.query,
        }),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка приема события телефонии');
    }
  }

  async getConfig(_req, res) {
    try {
      res.json(await telephonyService.getConfig());
    } catch (error) {
      handleError(res, error, 'Ошибка получения настроек телефонии');
    }
  }

  async getStats(_req, res) {
    try {
      res.json(await telephonyService.getStats(_req.account));
    } catch (error) {
      handleError(res, error, 'Ошибка получения статистики телефонии');
    }
  }

  async getReport(req, res) {
    try {
      res.json(await telephonyService.getReport(req.account, req.query));
    } catch (error) {
      handleError(res, error, 'Ошибка получения отчета телефонии');
    }
  }

  async getCalls(req, res) {
    try {
      res.json(await telephonyService.listCalls(req.account, req.query));
    } catch (error) {
      handleError(res, error, 'Ошибка получения звонков');
    }
  }

  async getCall(req, res) {
    try {
      res.json(await telephonyService.getCall(req.account, req.params.id));
    } catch (error) {
      handleError(res, error, 'Ошибка получения звонка');
    }
  }

  async startProcessing(req, res) {
    try {
      res.json(
        await telephonyService.startProcessing(req.account, req.params.id),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка начала обработки звонка');
    }
  }

  async linkClient(req, res) {
    try {
      res.json(
        await telephonyService.linkCallClient(req.account, req.params.id, req.body),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка привязки клиента к звонку');
    }
  }

  async createClient(req, res) {
    try {
      res.status(201).json(
        await telephonyService.createClientForCall(req.account, req.params.id, req.body),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка создания клиента из звонка');
    }
  }

  async completeCall(req, res) {
    try {
      res.json(
        await telephonyService.completeCall(req.account, req.params.id, req.body),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка завершения обработки звонка');
    }
  }

  async ignoreCall(req, res) {
    try {
      res.json(
        await telephonyService.ignoreCall(req.account, req.params.id, req.body),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка скрытия звонка');
    }
  }

  async syncStatistics(req, res) {
    try {
      res.json(await telephonyService.syncStatistics(req.body || {}));
    } catch (error) {
      handleError(res, error, 'Ошибка синхронизации статистики Билайна');
    }
  }

  async syncRecordings(req, res) {
    try {
      res.json(await telephonyService.syncRecordings(req.body || {}));
    } catch (error) {
      handleError(res, error, 'Ошибка синхронизации записей Билайна');
    }
  }

  async refreshRecordingReference(req, res) {
    try {
      res.json(
        await telephonyService.refreshRecordingReference(req.account, req.params.id),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка получения ссылки на запись звонка');
    }
  }

  async createTranscriptionJob(req, res) {
    try {
      res.status(201).json(
        await telephonyService.createTranscriptionJob(req.account, req.params.id),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка создания задачи транскрибации');
    }
  }

  async queueMissingTranscriptionJobs(req, res) {
    try {
      res.json(await telephonyService.queueMissingTranscriptionJobs(req.account, req.body || {}));
    } catch (error) {
      handleError(res, error, 'Ошибка массовой постановки транскрибаций');
    }
  }

  async listTranscriptionJobs(req, res) {
    try {
      res.json(await telephonyService.listTranscriptionJobs(req.account, req.query));
    } catch (error) {
      handleError(res, error, 'Ошибка получения задач транскрибации');
    }
  }

  async listCallTranscriptionJobs(req, res) {
    try {
      res.json(
        await telephonyService.listCallTranscriptionJobs(
          req.account,
          req.params.id,
          req.query,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка получения задач транскрибации звонка');
    }
  }

  async getTranscriptionStats(req, res) {
    try {
      res.json(await telephonyService.getTranscriptionStats(req.account));
    } catch (error) {
      handleError(res, error, 'Ошибка получения статистики транскрибации');
    }
  }

  async getWorkerTranscriptionQueue(req, res) {
    try {
      res.json(await telephonyService.getWorkerTranscriptionQueue(req.query || {}));
    } catch (error) {
      handleError(res, error, 'Ошибка получения очереди транскрибации для worker');
    }
  }

  async getTranscriptionJob(req, res) {
    try {
      res.json(await telephonyService.getTranscriptionJob(req.account, req.params.id));
    } catch (error) {
      handleError(res, error, 'Ошибка получения задачи транскрибации');
    }
  }

  async retryTranscriptionJob(req, res) {
    try {
      res.json(
        await telephonyService.retryTranscriptionJob(req.account, req.params.id),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка повторной постановки транскрибации');
    }
  }

  async claimTranscriptionJob(req, res) {
    try {
      res.json(await telephonyService.claimTranscriptionJob(req.body || {}));
    } catch (error) {
      handleError(res, error, 'Ошибка выдачи задачи транскрибации');
    }
  }

  async getTranscriptionJobAudioReference(req, res) {
    try {
      res.json(
        await telephonyService.getTranscriptionJobAudioReference(req.params.id),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка получения аудио для транскрибации');
    }
  }

  async updateTranscriptionJobProgress(req, res) {
    try {
      res.json(await telephonyService.updateTranscriptionJobProgress(req.params.id, req.body || {}));
    } catch (error) {
      handleError(res, error, 'Ошибка обновления прогресса транскрибации');
    }
  }

  async completeTranscriptionJob(req, res) {
    try {
      res.json(
        await telephonyService.completeTranscriptionJob(req.params.id, req.body || {}),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка сохранения транскрибации');
    }
  }

  async failTranscriptionJob(req, res) {
    try {
      res.json(
        await telephonyService.failTranscriptionJob(req.params.id, req.body || {}),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка сохранения ошибки транскрибации');
    }
  }

  async retryTranscriptionJobForWorker(req, res) {
    try {
      res.json(
        await telephonyService.retryTranscriptionJobForWorker(req.params.id, req.body || {}),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка повторной постановки транскрибации worker');
    }
  }

  async subscribe(req, res) {
    try {
      res.json(await telephonyService.subscribeToEvents(req.body || {}));
    } catch (error) {
      handleError(res, error, 'Ошибка создания подписки Билайна');
    }
  }

  async checkSubscription(_req, res) {
    try {
      res.json(await telephonyService.checkEventSubscription());
    } catch (error) {
      handleError(res, error, 'Ошибка проверки подписки Билайна');
    }
  }

  async getRawEvents(req, res) {
    try {
      res.json(await telephonyService.listRawEvents(req.query));
    } catch (error) {
      handleError(res, error, 'Ошибка получения событий телефонии');
    }
  }

  async reprocessRawEvent(req, res) {
    try {
      res.json(await telephonyService.reprocessRawEvent(req.params.id));
    } catch (error) {
      handleError(res, error, 'Ошибка повторной обработки события телефонии');
    }
  }
}

module.exports = new TelephonyController();
