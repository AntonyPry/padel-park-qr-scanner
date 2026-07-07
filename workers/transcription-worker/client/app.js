const state = {
  jobs: [],
  selectedJobId: null,
  status: null,
  detail: null,
};

const stageLabels = {
  waiting_in_crm: 'Ожидает задачу в CRM',
  queued: 'В очереди',
  claimed: 'Задача взята worker-ом',
  downloading_audio: 'Скачивание записи',
  ffmpeg_preprocess: 'Подготовка аудио',
  transcribing_admin_channel: 'Транскрибация администратора',
  transcribing_client_channel: 'Транскрибация клиента',
  transcribing_unknown_channel: 'Транскрибация mono/unknown',
  merging_segments: 'Сборка реплик по времени',
  uploading_result: 'Отправка результата в CRM',
  completed: 'Готово',
  failed: 'Ошибка',
  crm_connecting: 'CRM: подключение',
  crm_connected: 'CRM: подключено',
  claim_started: 'Claim',
  job_claimed: 'Задача получена',
  audio_reference_requested: 'Запрос audio-reference',
  audio_download_started: 'Скачивание аудио',
  audio_download_completed: 'Аудио скачано',
  ffprobe_started: 'ffprobe',
  ffprobe_completed: 'ffprobe готов',
  channel_split_started: 'Разделение каналов',
  channel_split_completed: 'Каналы готовы',
  asr_started: 'ASR',
  asr_channel_started: 'ASR канал',
  asr_channel_completed: 'ASR канал готов',
  segments_merged: 'Сегменты собраны',
  crm_submit_started: 'Отправка в CRM',
  crm_submit_completed: 'CRM приняла результат',
  job_completed: 'Готово',
  job_failed: 'Ошибка',
};

const statusLabels = {
  completed: 'готово',
  failed: 'ошибка',
  processing: 'в работе',
  queued: 'в очереди',
};

const stageProgress = {
  waiting_in_crm: 0,
  queued: 5,
  claimed: 10,
  downloading_audio: 25,
  ffmpeg_preprocess: 40,
  transcribing_admin_channel: 62,
  transcribing_client_channel: 78,
  transcribing_unknown_channel: 70,
  merging_segments: 88,
  uploading_result: 96,
  completed: 100,
  failed: 100,
};

function qs(selector) {
  return document.querySelector(selector);
}

function fmtDate(value) {
  if (!value) return '...';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
  });
}

function fmtDuration(ms) {
  if (ms === null || ms === undefined) return '...';
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const tail = seconds % 60;
  return minutes > 0 ? `${minutes}m ${tail}s` : `${seconds}s`;
}

function fmtAudioDuration(seconds) {
  if (!seconds && seconds !== 0) return '...';
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const tail = rounded % 60;
  return minutes > 0 ? `${minutes}:${String(tail).padStart(2, '0')}` : `${tail}s`;
}

function text(value) {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  if (value === null || value === undefined || value === '') return '...';
  return escapeHtml(String(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function jsonBlock(value) {
  return escapeHtml(JSON.stringify(value, null, 2));
}

function stageLabel(stage) {
  return stageLabels[stage] || stage || '...';
}

function statusClass(status) {
  if (status === 'completed') return 'status-ok';
  if (status === 'failed') return 'status-failed';
  if (status === 'processing') return 'status-processing';
  return '';
}

function stageFromStatus(status) {
  if (status === 'queued') return 'queued';
  if (status === 'processing') return 'claimed';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  return 'waiting_in_crm';
}

function progressFor(stage, status) {
  if (status === 'completed') return 100;
  if (status === 'failed') return 100;
  return stageProgress[stage] ?? stageProgress[stageFromStatus(status)] ?? 0;
}

function renderProgress(stage, status) {
  const value = progressFor(stage, status);
  return `
    <div class="progress" aria-label="progress ${value}%">
      <div class="progress-track"><div class="progress-fill" style="width: ${value}%"></div></div>
      <span>${value}%</span>
    </div>
  `;
}

function crmJobId(job) {
  return job.crmJobId || job.id || null;
}

function callId(job) {
  return job.callId || job.telephonyCallId || job.call?.id || job.crmJob?.call?.id || null;
}

function callPayload(job) {
  return job.call || job.crmJob?.call || {};
}

function clientLabel(job) {
  const call = callPayload(job);
  return call.client?.name || call.clientPhone || call.client?.phone || '...';
}

function rowDate(job) {
  const call = callPayload(job);
  return call.startedAt || job.createdAt || job.startedAt;
}

function audioSeconds(job) {
  const call = callPayload(job);
  return call.durationSeconds ?? job.audioDurationSeconds ?? null;
}

function openCrmUrl(job) {
  const id = callId(job);
  const base = state.status?.config?.crmFrontendUrl;
  if (!id || !base) return null;
  return `${base}/admin/telephony?callId=${encodeURIComponent(id)}`;
}

function combinedJobs() {
  const crmItems = state.status?.crmQueue?.items || [];
  const localItems = state.jobs || [];
  const localByCrmId = new Map();
  localItems.forEach((job) => {
    if (job.crmJobId) localByCrmId.set(String(job.crmJobId), job);
  });

  const rows = crmItems.map((job) => {
    const local = localByCrmId.get(String(job.id));
    return local
      ? { ...job, ...local, crmJob: local.crmJob || job, queueJob: job, source: 'local' }
      : { ...job, queueJob: job, source: 'crm' };
  });

  localItems.forEach((job) => {
    if (!job.crmJobId || !crmItems.some((item) => String(item.id) === String(job.crmJobId))) {
      rows.push({ ...job, source: 'local' });
    }
  });

  return rows;
}

function renderDefinitionList(target, items) {
  target.innerHTML = items
    .map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`)
    .join('');
}

function renderStatus() {
  const status = state.status;
  if (!status) return;
  const config = status.config || {};
  const deps = status.dependencies || {};
  const connection = status.connection || {};
  const polling = status.polling || {};

  qs('#pollingPill').textContent = polling.status || '...';
  qs('#pollingPill').className = polling.status === 'paused' ? 'pill warning' : 'pill';
  qs('#pauseButton').disabled = polling.status === 'paused';
  qs('#startButton').disabled = polling.status === 'running';
  qs('#claimOneButton').disabled = Boolean(polling.busy);

  renderDefinitionList(qs('#statusList'), [
    ['CRM API URL', text(config.crmApiUrl)],
    ['CRM connection', `<span class="${connection.crm === 'connected' ? 'status-ok' : 'status-failed'}">${text(connection.crm)}</span>`],
    ['Worker token', text(config.tokenConfigured)],
    ['whisper.cpp', text(deps.whisperCpp?.available)],
    ['ffmpeg', text(deps.ffmpeg?.available)],
    ['ffprobe', text(deps.ffprobe?.available)],
    ['Model', `${text(config.modelName)} / ${text(config.modelPath)}`],
    ['Polling', `${text(polling.status)}${polling.busy ? ' / busy' : ''}`],
  ]);

  const counters = status.counters || {};
  const crmTotals = status.crmQueue?.totals || {};
  qs('#counterGrid').innerHTML = [
    ['Нетранскрибированные в CRM', crmTotals.untranscribedInCrm ?? counters.queued ?? 0],
    ['В очереди', crmTotals.queued ?? counters.queued ?? 0],
    ['Сейчас обрабатывается', crmTotals.processing ?? counters.processing ?? 0],
    ['Готово сегодня', crmTotals.completedToday ?? 0],
    ['Ошибки', crmTotals.failed ?? counters.failed ?? 0],
    ['Среднее время worker', fmtDuration(counters.averageProcessingTimeMs)],
  ]
    .map(([label, value]) => `<div class="counter"><span>${label}</span><strong>${value}</strong></div>`)
    .join('');

  renderCurrentJob(status.currentJob);
  renderLiveEvents(status.events || []);
}

function renderCurrentJob(job) {
  if (!job) {
    qs('#currentStage').textContent = 'Нет активной задачи';
    qs('#currentStage').className = 'stage';
    qs('#currentJob').innerHTML = '<dt>status</dt><dd>idle</dd>';
    return;
  }
  qs('#currentStage').textContent = stageLabel(job.currentStage);
  qs('#currentStage').className = job.status === 'failed' ? 'stage danger' : 'stage';
  renderDefinitionList(qs('#currentJob'), [
    ['jobId', text(job.crmJobId)],
    ['localId', text(job.id)],
    ['callId', text(job.callId)],
    ['recording', text(job.recordingStatus)],
    ['duration', fmtAudioDuration(job.audioDurationSeconds)],
    ['channels', text(job.audioChannels)],
    ['stage', stageLabel(job.currentStage)],
    ['started', fmtDate(job.startedAt)],
  ]);
}

function renderLiveEvents(events) {
  const recent = events.slice(-12).reverse();
  qs('#liveEvents').innerHTML = recent.length
    ? recent
        .map(
          (event) => `
            <div class="event-row">
              <div class="event-time">${fmtDate(event.createdAt)}</div>
              <div>
                <div class="event-stage">${stageLabel(event.stage)}</div>
                <div>${text(event.message)}</div>
              </div>
            </div>
          `,
        )
        .join('')
    : '<div class="empty">Событий пока нет</div>';
}

function renderJobs() {
  const table = qs('#jobsTable');
  const rows = combinedJobs();
  table.innerHTML = rows.length
    ? rows
        .map(
          (job) => {
            const stage = job.currentStage || stageFromStatus(job.status);
            const crmUrl = openCrmUrl(job);
            const localId = job.source === 'local' ? job.id : null;
            return `
            <tr ${localId ? `data-job-id="${localId}"` : ''}>
              <td><strong>${text(callId(job))}</strong><br /><span class="event-time">${fmtDate(rowDate(job))}</span></td>
              <td>${text(clientLabel(job))}</td>
              <td>${fmtAudioDuration(audioSeconds(job))}</td>
              <td><span class="${statusClass(job.status)}">${statusLabels[job.status] || text(job.status)}</span></td>
              <td>${stageLabel(stage)}</td>
              <td>${renderProgress(stage, job.status)}</td>
              <td>${text(job.errorSummary)}</td>
              <td>
                <div class="row-actions">
                  ${
                    job.status === 'failed' && localId
                      ? `<button class="button ghost row-button" data-retry="${localId}" type="button">Retry</button>`
                      : ''
                  }
                  ${
                    crmUrl
                      ? `<a class="button ghost row-button" href="${escapeHtml(crmUrl)}" target="_blank" rel="noreferrer">Open CRM</a>`
                      : ''
                  }
                  ${
                    localId
                      ? `<button class="button ghost row-button" data-logs="${localId}" type="button">Local logs</button>`
                      : ''
                  }
                </div>
              </td>
            </tr>
          `;
          },
        )
        .join('')
    : '<tr><td colspan="8" class="empty">Очередь пуста: в CRM нет задач, а local history пока не записана</td></tr>';

  table.querySelectorAll('tr[data-job-id]').forEach((row) => {
    row.addEventListener('click', (event) => {
      if (event.target.closest('button, a')) return;
      selectJob(Number(row.dataset.jobId));
    });
  });
  table.querySelectorAll('[data-retry]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      await post(`/api/jobs/${button.dataset.retry}/retry`);
      await refreshAll();
    });
  });
  table.querySelectorAll('[data-logs]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      await selectJob(Number(button.dataset.logs));
    });
  });
}

function renderDetail() {
  const detail = state.detail;
  if (!detail) {
    qs('#detailPill').textContent = 'не выбрано';
    qs('#jobDetail').innerHTML = '<div class="empty">Выберите задачу в истории</div>';
    return;
  }
  qs('#detailPill').textContent = `local ${detail.id}`;
  const events = detail.events || [];
  qs('#jobDetail').innerHTML = `
    <div class="detail-section">
      <h3>Lifecycle events</h3>
      <div class="events-box">
        ${events
          .map(
            (event) => `
              <div class="event-row">
                <div class="event-time">${fmtDate(event.createdAt)}</div>
                <div>
                  <div class="event-stage">${stageLabel(event.stage)}</div>
                  <div>${text(event.message)}</div>
                </div>
              </div>
            `,
          )
          .join('') || '<div class="empty">Нет событий</div>'}
      </div>
    </div>
    <div class="detail-section">
      <h3>ffprobe</h3>
      <pre>${jsonBlock(detail.ffprobe || {})}</pre>
    </div>
    <div class="detail-section">
      <h3>Channel mapping</h3>
      <pre>${jsonBlock(detail.channelMapping || {})}</pre>
    </div>
    <div class="detail-section">
      <h3>ASR / submit</h3>
      <pre>${jsonBlock(
        {
          segments: detail.asrSegmentsCount,
          submitStatus: detail.submitStatus,
          model: detail.model,
          processingTimeMs: detail.processingTimeMs,
        }
      )}</pre>
    </div>
    ${
      detail.errorStack
        ? `<div class="detail-section"><h3>Technical details</h3><pre>${text(detail.errorStack)}</pre></div>`
        : ''
    }
  `;
}

async function getJson(path) {
  const response = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function post(path) {
  const response = await fetch(path, { method: 'POST', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function refreshAll() {
  const [status, jobs] = await Promise.all([getJson('/api/status'), getJson('/api/jobs')]);
  state.status = status;
  state.jobs = jobs.items || [];
  renderStatus();
  renderJobs();
  if (state.selectedJobId) await selectJob(state.selectedJobId, false);
  renderDetail();
}

async function selectJob(jobId, updateTable = true) {
  state.selectedJobId = jobId;
  state.detail = await getJson(`/api/jobs/${jobId}`);
  if (updateTable) renderJobs();
  renderDetail();
}

function connectEvents() {
  const source = new EventSource('/api/events');
  source.addEventListener('open', () => {
    qs('#ssePill').textContent = 'SSE connected';
    qs('#ssePill').className = 'pill';
  });
  source.addEventListener('error', () => {
    qs('#ssePill').textContent = 'SSE reconnecting';
    qs('#ssePill').className = 'pill warning';
  });
  source.addEventListener('snapshot', (event) => {
    state.status = JSON.parse(event.data);
    renderStatus();
  });
  source.addEventListener('worker_event', async () => {
    await refreshAll();
  });
}

function bindControls() {
  qs('#pauseButton').addEventListener('click', async () => {
    state.status = await post('/api/control/pause');
    renderStatus();
  });
  qs('#startButton').addEventListener('click', async () => {
    state.status = await post('/api/control/start');
    renderStatus();
  });
  qs('#claimOneButton').addEventListener('click', async () => {
    await post('/api/control/claim-one');
    await refreshAll();
  });
  qs('#refreshButton').addEventListener('click', refreshAll);
}

async function boot() {
  bindControls();
  connectEvents();
  await refreshAll();
}

boot().catch((error) => {
  qs('#liveEvents').innerHTML = `<div class="empty">${text(error.message)}</div>`;
});
