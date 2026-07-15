'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../../models');
const {
  isTenantFilesWorkersEnabled,
} = require('../tenant-context/capabilities');
const {
  requireDefaultTenantContext,
  resolveTrustedTenantAttribution,
  tenantMatches,
} = require('../files-workers/tenant-context');
const {
  atomicWriteStorageObject,
  buildTenantStorageKey,
  deleteStorageObject,
  resolveExistingStoragePath,
} = require('../storage/tenant-storage');

const { Op } = db.Sequelize;

const ACTIVE_TEMPLATE_INCLUDE = [
  {
    as: 'items',
    model: db.ShiftReportTemplateItem,
    required: false,
  },
];
const REPORT_INCLUDE = [
  {
    as: 'shift',
    model: db.Shift,
    required: true,
    include: [{ model: db.Staff, attributes: ['id', 'name', 'role'] }],
  },
  {
    as: 'template',
    model: db.ShiftReportTemplate,
    required: false,
  },
  {
    as: 'submittedBy',
    attributes: ['id', 'email', 'role'],
    model: db.Account,
    required: false,
  },
  {
    as: 'answers',
    model: db.ShiftReportAnswer,
    required: false,
  },
];

const LEGACY_UPLOAD_ROOT = path.resolve(__dirname, '../../var/shift-report-attachments');
const ATTACHMENT_STORAGE_DOMAIN = 'shift-report-attachments';
const ATTACHMENT_STORAGE_SCHEMA_VERSION = 1;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_ANSWER = 10;
const IMAGE_MIME_EXTENSIONS = new Map([
  ['image/heic', 'heic'],
  ['image/heif', 'heif'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);
const SCHEDULE_TYPES = new Set([
  'once_daily',
  'daily_times',
  'interval_hours',
  'shift_start',
  'shift_end',
]);
const ITEM_TYPES = new Set([
  'checkbox',
  'text',
  'number',
]);
const REPORT_STATUSES = new Set(['pending', 'draft', 'submitted', 'overdue']);

function toPlain(model) {
  return model?.toJSON ? model.toJSON() : model;
}

function makeError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function readJson(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

function normalizeString(value) {
  return String(value ?? '').trim();
}

function normalizeInteger(value, fallback = 0) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return fallback;
  return Math.trunc(normalized);
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const normalized = String(value).trim().toLowerCase();
  return ['true', '1', 'yes', 'on'].includes(normalized);
}

function normalizeStatus(value, fallback = 'active') {
  const status = normalizeString(value || fallback);
  if (!['active', 'archived'].includes(status)) {
    throw makeError('Некорректный статус');
  }
  return status;
}

function normalizeTime(value) {
  const time = normalizeString(value);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw makeError('Время должно быть в формате HH:mm');
  }
  return time;
}

function normalizeTimes(values) {
  const source = Array.isArray(values) ? values : [values].filter(Boolean);
  const times = Array.from(new Set(source.map(normalizeTime))).sort();
  if (times.length === 0) {
    throw makeError('Добавьте хотя бы одно время отчета');
  }
  if (times.length > 12) {
    throw makeError('В одном шаблоне можно указать до 12 времен');
  }
  return times;
}

function normalizeScheduleConfig(scheduleType, value = {}) {
  const config = readJson(value, {}) || {};

  if (scheduleType === 'once_daily') {
    const time = normalizeTime(config.time || config.times?.[0]);
    return { time, times: [time] };
  }

  if (scheduleType === 'daily_times') {
    return { times: normalizeTimes(config.times || config.time) };
  }

  if (scheduleType === 'interval_hours') {
    const startTime = normalizeTime(config.startTime || '09:00');
    const endTime = normalizeTime(config.endTime || '21:00');
    const everyHours = normalizeInteger(config.everyHours, 3);
    if (everyHours < 1 || everyHours > 12) {
      throw makeError('Интервал должен быть от 1 до 12 часов');
    }
    if (startTime >= endTime) {
      throw makeError('Время начала интервала должно быть раньше времени окончания');
    }
    return { endTime, everyHours, startTime };
  }

  return {};
}

function normalizeTemplatePayload(payload, existing = null) {
  const scheduleType = normalizeString(payload.scheduleType || existing?.scheduleType || 'daily_times');
  if (!SCHEDULE_TYPES.has(scheduleType)) {
    throw makeError('Некорректный тип расписания');
  }

  const name = normalizeString(payload.name ?? existing?.name);
  if (!name || name.length < 2) throw makeError('Укажите название шаблона');
  if (name.length > 160) throw makeError('Название шаблона слишком длинное');

  const gracePeriodMinutes = normalizeInteger(
    payload.gracePeriodMinutes ?? existing?.gracePeriodMinutes,
    30,
  );
  if (gracePeriodMinutes < 0 || gracePeriodMinutes > 720) {
    throw makeError('Допустимое опоздание должно быть от 0 до 720 минут');
  }

  return {
    appliesToRole: normalizeString(payload.appliesToRole ?? existing?.appliesToRole) || null,
    appliesToShiftType:
      normalizeString(payload.appliesToShiftType ?? existing?.appliesToShiftType) || null,
    description: normalizeString(payload.description ?? existing?.description) || null,
    gracePeriodMinutes,
    name,
    scheduleConfig: normalizeScheduleConfig(
      scheduleType,
      payload.scheduleConfig ?? existing?.scheduleConfig,
    ),
    scheduleType,
    sortOrder: normalizeInteger(payload.sortOrder ?? existing?.sortOrder, 0),
    status: normalizeStatus(payload.status ?? existing?.status ?? 'active'),
  };
}

function normalizeItemPayload(payload, existing = null) {
  const itemType = normalizeString(payload.itemType || existing?.itemType || 'checkbox');
  if (!ITEM_TYPES.has(itemType)) {
    throw makeError('Некорректный тип пункта отчета');
  }

  const label = normalizeString(payload.label ?? existing?.label);
  if (!label || label.length < 2) throw makeError('Укажите текст пункта отчета');
  if (label.length > 240) throw makeError('Пункт отчета слишком длинный');

  return {
    itemType,
    label,
    photoRequired: normalizeBoolean(payload.photoRequired, Boolean(existing?.photoRequired)),
    sortOrder: normalizeInteger(payload.sortOrder ?? existing?.sortOrder, 0),
    status: normalizeStatus(payload.status ?? existing?.status ?? 'active'),
  };
}

function buildTemplateSnapshot(template) {
  const plain = toPlain(template);
  return {
    appliesToRole: plain.appliesToRole || null,
    appliesToShiftType: plain.appliesToShiftType || null,
    description: plain.description || '',
    gracePeriodMinutes: Number(plain.gracePeriodMinutes) || 0,
    id: plain.id,
    name: plain.name,
    scheduleConfig: readJson(plain.scheduleConfig, {}),
    scheduleType: plain.scheduleType,
    sortOrder: Number(plain.sortOrder) || 0,
    version: Number(plain.version) || 1,
  };
}

function getTemplateItems(template, { activeOnly = false } = {}) {
  return (template.items || template.ShiftReportTemplateItems || [])
    .map(toPlain)
    .filter((item) => !activeOnly || item.status === 'active')
    .sort((left, right) => {
      const orderDiff = (Number(left.sortOrder) || 0) - (Number(right.sortOrder) || 0);
      return orderDiff || left.id - right.id;
    });
}

function buildItemSnapshot(item) {
  const plain = toPlain(item);
  return {
    id: plain.id,
    itemType: plain.itemType,
    label: plain.label,
    photoRequired: Boolean(plain.photoRequired),
    sortOrder: Number(plain.sortOrder) || 0,
  };
}

function getReportDeadline(report) {
  const plain = toPlain(report);
  const snapshot = readJson(plain.templateSnapshot, {});
  const gracePeriodMinutes = Number(snapshot.gracePeriodMinutes) || 0;
  return new Date(new Date(plain.scheduledAt).getTime() + gracePeriodMinutes * 60000);
}

function getComputedReportStatus(report, now = new Date()) {
  const plain = toPlain(report);
  if (plain.status === 'submitted') return 'submitted';
  if (new Date(plain.scheduledAt).getTime() <= now.getTime()) {
    const deadline = getReportDeadline(plain);
    if (deadline.getTime() < now.getTime()) return 'overdue';
  }
  return plain.status || 'pending';
}

function serializeAnswer(answer, reportId) {
  const plain = toPlain(answer);
  const attachments = readJson(plain.attachments, []) || [];
  return {
    ...plain,
    attachments: attachments.map((attachment) => ({
      id: attachment.id,
      mimeType: attachment.mimeType,
      originalName: attachment.originalName,
      size: attachment.size,
      uploadedAt: attachment.uploadedAt,
      uploadedByAccountId: attachment.uploadedByAccountId,
      url: `/api/shift-reports/${reportId}/answers/${plain.id}/attachments/${attachment.id}`,
    })),
    itemSnapshot: readJson(plain.itemSnapshot, {}),
    numberValue:
      plain.numberValue === null || plain.numberValue === undefined
        ? null
        : Number(plain.numberValue),
  };
}

function serializeReport(report, now = new Date()) {
  const plain = toPlain(report);
  const answers = (plain.answers || [])
    .map((answer) => serializeAnswer(answer, plain.id))
    .sort((left, right) => {
      const leftOrder = Number(left.itemSnapshot?.sortOrder) || 0;
      const rightOrder = Number(right.itemSnapshot?.sortOrder) || 0;
      return leftOrder - rightOrder || left.id - right.id;
    });

  return {
    ...plain,
    answers,
    computedStatus: getComputedReportStatus(plain, now),
    deadlineAt: getReportDeadline(plain).toISOString(),
    itemsSnapshot: readJson(plain.itemsSnapshot, []),
    templateSnapshot: readJson(plain.templateSnapshot, {}),
  };
}

function serializeTemplate(template) {
  const plain = toPlain(template);
  return {
    ...plain,
    items: getTemplateItems(plain, { activeOnly: true }).map((item) => ({
      ...item,
      photoRequired: Boolean(item.photoRequired),
    })),
    scheduleConfig: readJson(plain.scheduleConfig, {}),
  };
}

function addHours(time, hours) {
  const [hour, minute] = time.split(':').map(Number);
  const date = new Date(Date.UTC(2000, 0, 1, hour, minute));
  date.setUTCHours(date.getUTCHours() + hours);
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

function buildSlotsForTemplate(template, shift) {
  const snapshot = buildTemplateSnapshot(template);
  const config = snapshot.scheduleConfig || {};

  if (snapshot.scheduleType === 'shift_start') {
    return shift.startedAt
      ? [{ key: 'shift_start', scheduledAt: new Date(shift.startedAt) }]
      : [];
  }

  if (snapshot.scheduleType === 'shift_end') {
    return shift.endedAt
      ? [{ key: 'shift_end', scheduledAt: new Date(shift.endedAt) }]
      : [];
  }

  if (snapshot.scheduleType === 'interval_hours') {
    const times = [];
    let time = config.startTime || '09:00';
    let guard = 0;
    while (time <= (config.endTime || '21:00') && guard < 24) {
      times.push(time);
      const nextTime = addHours(time, Number(config.everyHours) || 3);
      if (nextTime <= time) break;
      time = nextTime;
      guard += 1;
    }
    return times.map((slotTime) => ({
      key: `time:${slotTime}`,
      scheduledAt: new Date(`${shift.date}T${slotTime}:00+03:00`),
    }));
  }

  const times = snapshot.scheduleType === 'once_daily'
    ? [config.time || config.times?.[0]]
    : config.times;

  return normalizeTimes(times).map((slotTime) => ({
    key: `time:${slotTime}`,
    scheduledAt: new Date(`${shift.date}T${slotTime}:00+03:00`),
  }));
}

async function bumpTemplateVersion(templateId, transaction) {
  const template = await db.ShiftReportTemplate.findByPk(templateId, { transaction });
  if (!template) return null;
  await template.update(
    { version: Number(template.version || 1) + 1 },
    { transaction },
  );
  return template;
}

async function listTemplates(query = {}) {
  const status = query.status || 'active';
  const where = status === 'all' ? {} : { status };
  const templates = await db.ShiftReportTemplate.findAll({
    include: ACTIVE_TEMPLATE_INCLUDE,
    order: [
      ['sortOrder', 'ASC'],
      ['id', 'ASC'],
      [{ as: 'items', model: db.ShiftReportTemplateItem }, 'sortOrder', 'ASC'],
      [{ as: 'items', model: db.ShiftReportTemplateItem }, 'id', 'ASC'],
    ],
    where,
  });
  return templates.map(serializeTemplate);
}

async function createTemplate(payload, account) {
  const normalized = normalizeTemplatePayload(payload);
  const template = await db.ShiftReportTemplate.create({
    ...normalized,
    archivedAt: normalized.status === 'archived' ? new Date() : null,
    createdByAccountId: account?.id || null,
    updatedByAccountId: account?.id || null,
  });
  return getTemplate(template.id);
}

async function getTemplate(id) {
  const template = await db.ShiftReportTemplate.findByPk(id, {
    include: ACTIVE_TEMPLATE_INCLUDE,
    order: [[{ as: 'items', model: db.ShiftReportTemplateItem }, 'sortOrder', 'ASC']],
  });
  if (!template) throw makeError('Шаблон отчета не найден', 404);
  return serializeTemplate(template);
}

async function updateTemplate(id, payload, account) {
  const template = await db.ShiftReportTemplate.findByPk(id);
  if (!template) throw makeError('Шаблон отчета не найден', 404);
  const normalized = normalizeTemplatePayload(payload, template);
  await template.update({
    ...normalized,
    archivedAt:
      normalized.status === 'archived'
        ? template.archivedAt || new Date()
        : null,
    updatedByAccountId: account?.id || null,
    version: Number(template.version || 1) + 1,
  });
  return getTemplate(template.id);
}

async function setTemplateStatus(id, status, account) {
  return updateTemplate(id, { status }, account);
}

async function createTemplateItem(templateId, payload, account) {
  const template = await db.ShiftReportTemplate.findByPk(templateId);
  if (!template) throw makeError('Шаблон отчета не найден', 404);
  const normalized = normalizeItemPayload(payload);
  await db.sequelize.transaction(async (transaction) => {
    await db.ShiftReportTemplateItem.create(
      {
        ...normalized,
        archivedAt: normalized.status === 'archived' ? new Date() : null,
        templateId: template.id,
      },
      { transaction },
    );
    await template.update(
      {
        updatedByAccountId: account?.id || null,
        version: Number(template.version || 1) + 1,
      },
      { transaction },
    );
  });
  return getTemplate(template.id);
}

async function updateTemplateItem(id, payload, account) {
  const item = await db.ShiftReportTemplateItem.findByPk(id);
  if (!item) throw makeError('Пункт отчета не найден', 404);
  const normalized = normalizeItemPayload(payload, item);
  await db.sequelize.transaction(async (transaction) => {
    await item.update(
      {
        ...normalized,
        archivedAt:
          normalized.status === 'archived'
            ? item.archivedAt || new Date()
            : null,
      },
      { transaction },
    );
    const template = await bumpTemplateVersion(item.templateId, transaction);
    if (template) {
      await template.update({ updatedByAccountId: account?.id || null }, { transaction });
    }
  });
  return getTemplate(item.templateId);
}

async function setTemplateItemStatus(id, status, account) {
  return updateTemplateItem(id, { status }, account);
}

async function ensureReportsForShift(shiftInput) {
  if (!shiftInput) return [];
  const shift = toPlain(shiftInput);
  const templates = await db.ShiftReportTemplate.findAll({
    include: ACTIVE_TEMPLATE_INCLUDE,
    order: [
      ['sortOrder', 'ASC'],
      ['id', 'ASC'],
      [{ as: 'items', model: db.ShiftReportTemplateItem }, 'sortOrder', 'ASC'],
      [{ as: 'items', model: db.ShiftReportTemplateItem }, 'id', 'ASC'],
    ],
    where: { status: 'active' },
  });

  const createdReports = [];
  for (const template of templates) {
    const activeItems = getTemplateItems(template, { activeOnly: true });
    if (activeItems.length === 0) continue;

    const slots = buildSlotsForTemplate(template, shift);
    for (const slot of slots) {
      const existing = await db.ShiftReport.findOne({
        where: {
          scheduledSlotKey: slot.key,
          shiftId: shift.id,
          templateId: template.id,
        },
      });
      if (existing) {
        createdReports.push(existing);
        continue;
      }

      const templateSnapshot = buildTemplateSnapshot(template);
      const itemsSnapshot = activeItems.map(buildItemSnapshot);
      const report = await db.sequelize.transaction(async (transaction) => {
        const created = await db.ShiftReport.create(
          {
            itemsSnapshot,
            scheduledAt: slot.scheduledAt,
            scheduledSlotKey: slot.key,
            shiftId: shift.id,
            status: 'pending',
            templateId: template.id,
            templateSnapshot,
            templateVersion: templateSnapshot.version,
          },
          { transaction },
        );

        await db.ShiftReportAnswer.bulkCreate(
          itemsSnapshot.map((item) => ({
            attachments: [],
            itemLabel: item.label,
            itemSnapshot: item,
            itemType: item.itemType,
            photoRequired: item.photoRequired,
            reportId: created.id,
            templateItemId: item.id,
          })),
          { transaction },
        );

        return created;
      });
      createdReports.push(report);
    }
  }

  return createdReports;
}

async function getActiveShiftReports(account) {
  const shift = await db.Shift.findOne({
    include: [{ model: db.Staff, attributes: ['id', 'name', 'role'] }],
    order: [['startedAt', 'DESC']],
    where: { archivedAt: null, status: 'active' },
  });
  if (!shift) return { reports: [], shift: null };

  await ensureReportsForShift(shift);
  const reports = await db.ShiftReport.findAll({
    include: REPORT_INCLUDE,
    order: [['scheduledAt', 'ASC'], ['id', 'ASC']],
    where: { shiftId: shift.id },
  });
  return {
    reports: reports
      .filter((report) => canOperateReport(report, account))
      .map((report) => serializeReport(report)),
    shift: toPlain(shift),
  };
}

function canViewAllReports(account) {
  return ['owner', 'manager'].includes(account?.role);
}

function canOperateReport(report, account) {
  if (canViewAllReports(account)) return true;
  const shift = toPlain(report.shift || report.Shift);
  if (account?.role !== 'admin' || !shift || shift.status !== 'active') return false;
  if (!account.staffId || !shift.staffId) return true;
  return Number(account.staffId) === Number(shift.staffId);
}

async function assertReportAccess(report, account) {
  if (!report) throw makeError('Отчет смены не найден', 404);
  if (!canOperateReport(report, account)) {
    throw makeError('Недостаточно прав для этого отчета', 403);
  }
}

function buildDateRange(query) {
  if (query.date) {
    return {
      [Op.gte]: new Date(`${query.date}T00:00:00+03:00`),
      [Op.lte]: new Date(`${query.date}T23:59:59+03:00`),
    };
  }
  const range = {};
  let hasRange = false;
  if (query.from) range[Op.gte] = new Date(`${query.from}T00:00:00+03:00`);
  if (query.from) hasRange = true;
  if (query.to) range[Op.lte] = new Date(`${query.to}T23:59:59+03:00`);
  if (query.to) hasRange = true;
  return hasRange ? range : null;
}

async function listReports(query = {}, account) {
  const where = {};
  if (query.shiftId) where.shiftId = Number(query.shiftId);
  if (query.templateId) where.templateId = Number(query.templateId);
  const scheduledAt = buildDateRange(query);
  if (scheduledAt) where.scheduledAt = scheduledAt;
  if (query.status && query.status !== 'all' && query.status !== 'overdue') {
    where.status = query.status;
  }

  if (!canViewAllReports(account)) {
    const activeShift = await db.Shift.findOne({
      where: { archivedAt: null, status: 'active' },
    });
    if (!activeShift) return [];
    where.shiftId = activeShift.id;
  }

  const reports = await db.ShiftReport.findAll({
    include: REPORT_INCLUDE,
    order: [['scheduledAt', 'DESC'], ['id', 'DESC']],
    where,
  });
  const serialized = reports
    .filter((report) => canOperateReport(report, account))
    .map((report) => serializeReport(report));

  if (query.status && query.status !== 'all') {
    return serialized.filter((report) => report.computedStatus === query.status);
  }

  return serialized;
}

async function getReport(id, account) {
  const report = await db.ShiftReport.findByPk(id, { include: REPORT_INCLUDE });
  await assertReportAccess(report, account);
  return serializeReport(report);
}

function normalizeAnswerValue(answer, payload) {
  const itemType = answer.itemType;
  const next = {
    booleanValue: null,
    numberValue: null,
    textValue: null,
  };

  if (itemType === 'checkbox') {
    next.booleanValue = normalizeBoolean(payload.booleanValue);
  }

  if (itemType === 'text') {
    next.textValue = normalizeString(payload.textValue);
  }

  if (itemType === 'number') {
    const rawNumber = payload.numberValue;
    if (rawNumber !== undefined && rawNumber !== null && rawNumber !== '') {
      const numberValue = Number(String(rawNumber).replace(',', '.'));
      if (!Number.isFinite(numberValue)) throw makeError('Укажите корректное число');
      next.numberValue = numberValue;
    }
  }

  return next;
}

function validateRequiredAnswers(answers) {
  const missing = [];
  answers.forEach((answer) => {
    if (
      answer.itemType === 'checkbox' &&
      answer.booleanValue !== true
    ) {
      missing.push(answer.itemLabel);
    }
    if (
      answer.itemType === 'text' &&
      !normalizeString(answer.textValue)
    ) {
      missing.push(answer.itemLabel);
    }
    if (
      answer.itemType === 'number' &&
      (answer.numberValue === null || answer.numberValue === undefined)
    ) {
      missing.push(answer.itemLabel);
    }
  });

  if (missing.length > 0) {
    throw makeError(`Заполните обязательные пункты: ${missing.join(', ')}`);
  }
}

async function saveReport(id, payload, account, { submit = false } = {}) {
  const report = await db.ShiftReport.findByPk(id, { include: REPORT_INCLUDE });
  await assertReportAccess(report, account);
  if (report.status === 'submitted') {
    throw makeError('Сданный отчет нельзя редактировать', 409);
  }

  const incomingAnswers = Array.isArray(payload.answers) ? payload.answers : [];
  const answerById = new Map(report.answers.map((answer) => [Number(answer.id), answer]));
  const reportComment = normalizeString(payload.comment) || null;

  await db.sequelize.transaction(async (transaction) => {
    for (const incoming of incomingAnswers) {
      const answer = answerById.get(Number(incoming.id));
      if (!answer) continue;
      await answer.update(normalizeAnswerValue(answer, incoming), { transaction });
    }
  });

  const freshReport = await db.ShiftReport.findByPk(id, { include: REPORT_INCLUDE });
  if (submit) validateRequiredAnswers(freshReport.answers || []);

  await freshReport.update({
    comment: reportComment,
    status: submit ? 'submitted' : 'draft',
    submittedAt: submit ? new Date() : null,
    submittedByAccountId: submit ? account?.id || null : null,
  });

  return getReport(id, account);
}

function parseDataUrl(data, mimeType) {
  const value = normalizeString(data);
  const dataUrlMatch = value.match(/^data:([^;]+);base64,(.+)$/);
  if (dataUrlMatch) {
    return {
      buffer: Buffer.from(dataUrlMatch[2], 'base64'),
      mimeType: dataUrlMatch[1],
    };
  }
  return {
    buffer: Buffer.from(value, 'base64'),
    mimeType,
  };
}

function assertAnswerAllowsPhoto(answer) {
  if (!answer.photoRequired) {
    throw makeError('К этому пункту нельзя прикрепить фото');
  }
}

function hasTenantAttachmentMetadata(attachment) {
  return [
    'storageSchemaVersion',
    'storageKey',
    'organizationId',
    'clubId',
    'domain',
    'record',
    'checksumSha256',
  ].some((key) => attachment?.[key] !== undefined && attachment?.[key] !== null);
}

function assertTenantAttachmentMetadata(attachment, reportId, answerId, tenant) {
  const record = attachment?.record || {};
  let expectedStorageKey = null;
  try {
    expectedStorageKey = buildTenantStorageKey({
      clubId: tenant?.clubId,
      domain: ATTACHMENT_STORAGE_DOMAIN,
      fileId: attachment?.id,
      organizationId: tenant?.organizationId,
      recordId: `report:${Number(reportId)}:answer:${Number(answerId)}`,
    });
  } catch (_error) {
    // The public result is intentionally the same for invalid/missing tenant metadata.
  }
  const matchesIdentity =
    Number(record.reportId) === Number(reportId) &&
    Number(record.answerId) === Number(answerId) &&
    String(record.fileId || '') === String(attachment?.id || '');
  const valid =
    Number(attachment?.storageSchemaVersion) === ATTACHMENT_STORAGE_SCHEMA_VERSION &&
    attachment?.domain === ATTACHMENT_STORAGE_DOMAIN &&
    attachment?.storageKey === expectedStorageKey &&
    /^[a-f0-9]{64}$/.test(String(attachment?.checksumSha256 || '')) &&
    tenantMatches(attachment, tenant) &&
    matchesIdentity;
  if (!valid) {
    throw makeError('Фото не найдено', 404);
  }
}

function assertLegacyAttachmentMetadata(attachment, reportId) {
  if (hasTenantAttachmentMetadata(attachment)) {
    throw makeError('Фото не найдено', 404);
  }
  const attachmentId = String(attachment?.id || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attachmentId)) {
    throw makeError('Фото не найдено', 404);
  }
  const extension = IMAGE_MIME_EXTENSIONS.get(attachment?.mimeType);
  const expectedPath = extension
    ? path.join(String(Number(reportId)), `${attachmentId}.${extension}`)
    : null;
  if (!expectedPath || attachment?.relativePath !== expectedPath) {
    throw makeError('Фото не найдено', 404);
  }
  return expectedPath;
}

async function resolveLegacyAttachmentPath(attachment, reportId, tenant) {
  await requireDefaultTenantContext(tenant);
  const relativePath = assertLegacyAttachmentMetadata(attachment, reportId);
  const candidate = path.resolve(LEGACY_UPLOAD_ROOT, relativePath);
  const relative = path.relative(LEGACY_UPLOAD_ROOT, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw makeError('Фото не найдено', 404);
  }

  let rootRealPath;
  let candidateRealPath;
  try {
    const candidateStat = await fs.promises.lstat(candidate);
    if (candidateStat.isSymbolicLink() || !candidateStat.isFile()) {
      throw makeError('Фото не найдено', 404);
    }
    rootRealPath = await fs.promises.realpath(LEGACY_UPLOAD_ROOT);
    candidateRealPath = await fs.promises.realpath(candidate);
  } catch (error) {
    if (error.code === 'ENOENT') throw makeError('Фото не найдено', 404);
    throw error;
  }
  const realRelative = path.relative(rootRealPath, candidateRealPath);
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    throw makeError('Фото не найдено', 404);
  }
  return candidateRealPath;
}

async function uploadAttachment(reportId, answerId, payload, account, requestTenant = null) {
  const report = await db.ShiftReport.findByPk(reportId, { include: REPORT_INCLUDE });
  await assertReportAccess(report, account);
  if (report.status === 'submitted') {
    throw makeError('К сданному отчету нельзя добавлять фото', 409);
  }

  const answer = (report.answers || []).find(
    (item) => Number(item.id) === Number(answerId),
  );
  if (!answer) throw makeError('Пункт отчета не найден', 404);
  assertAnswerAllowsPhoto(answer);
  const attachments = readJson(answer.attachments, []) || [];
  if (attachments.length >= MAX_ATTACHMENTS_PER_ANSWER) {
    throw makeError(`К одному пункту можно прикрепить до ${MAX_ATTACHMENTS_PER_ANSWER} фото`);
  }

  const parsed = parseDataUrl(payload.data, payload.mimeType);
  if (!IMAGE_MIME_EXTENSIONS.has(parsed.mimeType)) {
    throw makeError('Можно прикреплять только JPEG, PNG, WEBP, GIF или HEIC');
  }
  if (parsed.buffer.length > MAX_ATTACHMENT_BYTES) {
    throw makeError('Фото должно быть не больше 5 МБ');
  }

  const attachmentId = crypto.randomUUID();
  const extension = IMAGE_MIME_EXTENSIONS.get(parsed.mimeType);
  let attachment;

  if (isTenantFilesWorkersEnabled()) {
    const tenant = await requireDefaultTenantContext(requestTenant);
    const storageKey = buildTenantStorageKey({
      clubId: tenant.clubId,
      domain: ATTACHMENT_STORAGE_DOMAIN,
      fileId: attachmentId,
      organizationId: tenant.organizationId,
      recordId: `report:${report.id}:answer:${answer.id}`,
    });
    const stored = await atomicWriteStorageObject({ storageKey, buffer: parsed.buffer });
    attachment = {
      checksumSha256: stored.checksumSha256,
      clubId: tenant.clubId,
      domain: ATTACHMENT_STORAGE_DOMAIN,
      id: attachmentId,
      mimeType: parsed.mimeType,
      organizationId: tenant.organizationId,
      originalName: normalizeString(payload.fileName) || `photo.${extension}`,
      record: {
        answerId: Number(answer.id),
        fileId: attachmentId,
        reportId: Number(report.id),
      },
      size: stored.size,
      storageKey: stored.storageKey,
      storageSchemaVersion: ATTACHMENT_STORAGE_SCHEMA_VERSION,
      uploadedAt: new Date().toISOString(),
      uploadedByAccountId: account?.id || null,
    };
    try {
      await answer.update({ attachments: [...attachments, attachment] });
    } catch (error) {
      await deleteStorageObject({ storageKey }).catch(() => {});
      throw error;
    }
  } else {
    const relativePath = path.join(String(report.id), `${attachmentId}.${extension}`);
    const directory = path.join(LEGACY_UPLOAD_ROOT, String(report.id));
    await fs.promises.mkdir(directory, { recursive: true });
    await fs.promises.writeFile(path.join(LEGACY_UPLOAD_ROOT, relativePath), parsed.buffer);
    attachment = {
      id: attachmentId,
      mimeType: parsed.mimeType,
      originalName: normalizeString(payload.fileName) || `photo.${extension}`,
      relativePath,
      size: parsed.buffer.length,
      uploadedAt: new Date().toISOString(),
      uploadedByAccountId: account?.id || null,
    };
    await answer.update({ attachments: [...attachments, attachment] });
  }

  return serializeAnswer(await db.ShiftReportAnswer.findByPk(answer.id), report.id);
}

async function removeAttachment(reportId, answerId, attachmentId, account, requestTenant = null) {
  const report = await db.ShiftReport.findByPk(reportId, { include: REPORT_INCLUDE });
  await assertReportAccess(report, account);
  if (report.status === 'submitted') {
    throw makeError('У сданного отчета нельзя удалять фото', 409);
  }
  const answer = (report.answers || []).find(
    (item) => Number(item.id) === Number(answerId),
  );
  if (!answer) throw makeError('Пункт отчета не найден', 404);
  const attachments = readJson(answer.attachments, []) || [];
  const attachment = attachments.find((item) => item.id === attachmentId);
  if (!attachment) throw makeError('Фото не найдено', 404);

  const tenant = await resolveTrustedTenantAttribution(requestTenant);
  let removePhysicalFile;
  if (hasTenantAttachmentMetadata(attachment)) {
    assertTenantAttachmentMetadata(attachment, reportId, answerId, tenant);
    removePhysicalFile = () => deleteStorageObject({ storageKey: attachment.storageKey });
  } else {
    const absolutePath = await resolveLegacyAttachmentPath(attachment, reportId, tenant);
    removePhysicalFile = () => fs.promises.unlink(absolutePath).then(() => true);
  }

  await answer.update({
    attachments: attachments.filter((item) => item.id !== attachmentId),
  });
  await removePhysicalFile().catch(() => {});

  return serializeAnswer(await db.ShiftReportAnswer.findByPk(answer.id), report.id);
}

async function getAttachment(reportId, answerId, attachmentId, account, requestTenant = null) {
  const report = await db.ShiftReport.findByPk(reportId, { include: REPORT_INCLUDE });
  await assertReportAccess(report, account);
  const answer = (report.answers || []).find(
    (item) => Number(item.id) === Number(answerId),
  );
  if (!answer) throw makeError('Пункт отчета не найден', 404);
  const attachment = (readJson(answer.attachments, []) || []).find(
    (item) => item.id === attachmentId,
  );
  if (!attachment) throw makeError('Фото не найдено', 404);
  const tenant = await resolveTrustedTenantAttribution(requestTenant);
  let absolutePath;
  if (hasTenantAttachmentMetadata(attachment)) {
    assertTenantAttachmentMetadata(attachment, reportId, answerId, tenant);
    try {
      absolutePath = await resolveExistingStoragePath({ storageKey: attachment.storageKey });
    } catch (error) {
      if (error.code === 'ENOENT') throw makeError('Фото не найдено', 404);
      throw error;
    }
  } else {
    absolutePath = await resolveLegacyAttachmentPath(attachment, reportId, tenant);
  }
  return {
    absolutePath,
    attachment,
  };
}

module.exports = {
  ATTACHMENT_STORAGE_DOMAIN,
  ATTACHMENT_STORAGE_SCHEMA_VERSION,
  ITEM_TYPES: Array.from(ITEM_TYPES),
  LEGACY_UPLOAD_ROOT,
  REPORT_STATUSES: Array.from(REPORT_STATUSES),
  SCHEDULE_TYPES: Array.from(SCHEDULE_TYPES),
  createTemplate,
  createTemplateItem,
  ensureReportsForShift,
  getActiveShiftReports,
  getAttachment,
  getReport,
  getTemplate,
  listReports,
  listTemplates,
  removeAttachment,
  saveReport,
  serializeReport,
  setTemplateItemStatus,
  setTemplateStatus,
  updateTemplate,
  updateTemplateItem,
  uploadAttachment,
  assertLegacyAttachmentMetadata,
  assertTenantAttachmentMetadata,
  hasTenantAttachmentMetadata,
};
