'use strict';

const INDEXES = [
  ['Users', ['status', 'mergedIntoUserId', 'phoneNormalized'], 'idx_users_status_merged_phone'],
  ['Users', ['status', 'mergedIntoUserId', 'createdAt'], 'idx_users_status_merged_created'],
  ['Users', ['status', 'sourceId'], 'idx_users_status_source_id'],
  ['Users', ['status', 'source'], 'idx_users_status_source'],
  ['Users', ['status', 'mergedIntoUserId', 'telegramId'], 'idx_users_status_merged_tg'],
  ['Users', ['status', 'mergedIntoUserId', 'vkId'], 'idx_users_status_merged_vk'],
  ['Users', ['status', 'mergedIntoUserId', 'webId'], 'idx_users_status_merged_web'],

  ['Visits', ['userId', 'scannedAt', 'createdAt'], 'idx_visits_user_scanned_created'],
  ['Visits', ['scannedAt', 'createdAt'], 'idx_visits_scanned_created'],
  ['Visits', ['category'], 'idx_visits_category'],

  ['TrainingNotes', ['userId', 'trainedAt', 'createdAt'], 'idx_training_notes_user_trained_created'],

  ['Receipts', ['dateTime'], 'idx_receipts_date_time'],
  ['Receipts', ['dateTime', 'type'], 'idx_receipts_date_time_type'],
  ['Receipts', ['paymentSource'], 'idx_receipts_payment_source'],
  ['ReceiptItems', ['receiptId'], 'idx_receipt_items_receipt_id'],
  ['ReceiptItems', ['name'], 'idx_receipt_items_name'],

  ['Finances', ['date', 'type'], 'idx_finances_date_type'],
  ['Shifts', ['date', 'archivedAt'], 'idx_shifts_date_archived'],
  ['Shifts', ['status', 'startedAt'], 'idx_shifts_status_started'],
  ['Shifts', ['staffId', 'date'], 'idx_shifts_staff_date'],

  ['ClientBases', ['status', 'updatedAt'], 'idx_client_bases_status_updated'],
  ['ClientBases', ['recurringEnabled', 'recurringNextRunAt'], 'idx_client_bases_recurring_next'],

  ['CallTasks', ['status', 'dueAt', 'createdAt'], 'idx_call_tasks_status_due_created'],
  ['CallTasks', ['clientBaseId', 'status'], 'idx_call_tasks_base_status'],
  ['CallTaskClients', ['callTaskId', 'status'], 'idx_call_task_clients_task_status'],
  ['CallTaskClients', ['callTaskId', 'deadlineAt', 'status'], 'idx_call_task_clients_task_deadline_status'],
  ['CallTaskClients', ['userId'], 'idx_call_task_clients_user_id'],
  ['CallTaskClients', ['status', 'deadlineAt'], 'idx_call_task_clients_status_deadline'],
  ['CallTaskAttempts', ['callTaskClientId', 'createdAt'], 'idx_call_task_attempts_client_created'],

  ['AuditLogs', ['action', 'createdAt'], 'idx_audit_logs_action_created'],
  ['AuditLogs', ['entityType', 'entityId', 'createdAt'], 'idx_audit_logs_entity_created'],
  ['AuditLogs', ['accountId', 'createdAt'], 'idx_audit_logs_account_created'],

  ['ScannerEvents', ['createdAt'], 'idx_scanner_events_created'],
  ['ScannerEvents', ['qrHash', 'clientEventId'], 'idx_scanner_events_hash_event'],
];

async function safeAddIndex(queryInterface, tableName, fields, name) {
  try {
    await queryInterface.addIndex(tableName, fields, { name });
  } catch (error) {
    const message = String(error?.parent?.sqlMessage || error?.message || '');
    if (
      error?.parent?.code === 'ER_DUP_KEYNAME' ||
      message.includes('Duplicate key name')
    ) {
      return;
    }

    throw error;
  }
}

async function safeRemoveIndex(queryInterface, tableName, name) {
  try {
    await queryInterface.removeIndex(tableName, name);
  } catch (error) {
    const message = String(error?.parent?.sqlMessage || error?.message || '');
    if (
      error?.parent?.code === 'ER_CANT_DROP_FIELD_OR_KEY' ||
      message.includes("check that column/key exists")
    ) {
      return;
    }

    throw error;
  }
}

module.exports = {
  async up(queryInterface) {
    for (const [tableName, fields, name] of INDEXES) {
      await safeAddIndex(queryInterface, tableName, fields, name);
    }
  },

  async down(queryInterface) {
    for (const [tableName, , name] of [...INDEXES].reverse()) {
      await safeRemoveIndex(queryInterface, tableName, name);
    }
  },
};
