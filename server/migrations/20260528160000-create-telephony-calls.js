'use strict';

const PROVIDER_VALUES = ['beeline'];
const RAW_EVENT_STATUS_VALUES = ['new', 'processed', 'failed'];
const CALL_DIRECTION_VALUES = ['inbound', 'outbound', 'unknown'];
const CALL_STATUS_VALUES = [
  'new',
  'ringing',
  'answered',
  'completed',
  'missed',
  'failed',
  'unknown',
];
const PROCESSING_STATUS_VALUES = ['new', 'in_progress', 'processed', 'ignored'];
const RECORDING_STATUS_VALUES = ['unknown', 'pending', 'available', 'missing'];
const RESULT_VALUES = [
  'booked',
  'refused',
  'thinking',
  'callback',
  'complaint',
  'corporate',
  'no_answer',
  'other',
];
const INTEREST_VALUES = [
  'game',
  'training',
  'tournament',
  'master_class',
  'corporate',
  'other',
];

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('TelephonyCalls', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      provider: {
        type: Sequelize.ENUM(...PROVIDER_VALUES),
        allowNull: false,
        defaultValue: 'beeline',
      },
      externalCallId: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      externalTrackingId: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      recordId: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      recordExternalId: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      clientPhone: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      clientPhoneNormalized: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      employeePhone: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      beelineUserId: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      abonentExtension: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      staffId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Staffs',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      direction: {
        type: Sequelize.ENUM(...CALL_DIRECTION_VALUES),
        allowNull: false,
        defaultValue: 'unknown',
      },
      callStatus: {
        type: Sequelize.ENUM(...CALL_STATUS_VALUES),
        allowNull: false,
        defaultValue: 'new',
      },
      processingStatus: {
        type: Sequelize.ENUM(...PROCESSING_STATUS_VALUES),
        allowNull: false,
        defaultValue: 'new',
      },
      startedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      answeredAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      endedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      durationSeconds: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      recordingStatus: {
        type: Sequelize.ENUM(...RECORDING_STATUS_VALUES),
        allowNull: false,
        defaultValue: 'unknown',
      },
      recordingUrl: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      recordingExpiresAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      recordingFileSize: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      recordingFileType: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      recordingSyncedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      result: {
        type: Sequelize.ENUM(...RESULT_VALUES),
        allowNull: true,
      },
      interest: {
        type: Sequelize.ENUM(...INTEREST_VALUES),
        allowNull: true,
      },
      summary: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      nextActionAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      nextActionText: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      processedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      processedByAccountId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      linkedBookingId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Bookings',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      followUpCallTaskId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'CallTasks',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      rawSnapshot: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });

    await queryInterface.createTable('TelephonyRawEvents', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      provider: {
        type: Sequelize.ENUM(...PROVIDER_VALUES),
        allowNull: false,
        defaultValue: 'beeline',
      },
      eventType: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      externalEventId: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      payload: {
        type: Sequelize.JSON,
        allowNull: false,
      },
      headers: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      query: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      sourceIp: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      receivedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      processingStatus: {
        type: Sequelize.ENUM(...RAW_EVENT_STATUS_VALUES),
        allowNull: false,
        defaultValue: 'new',
      },
      processingError: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      telephonyCallId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'TelephonyCalls',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });

    await queryInterface.addIndex('TelephonyCalls', ['externalCallId'], {
      name: 'telephony_calls_external_call_id_idx',
    });
    await queryInterface.addIndex('TelephonyCalls', ['externalTrackingId'], {
      name: 'telephony_calls_external_tracking_id_idx',
    });
    await queryInterface.addIndex('TelephonyCalls', ['recordId'], {
      name: 'telephony_calls_record_id_idx',
    });
    await queryInterface.addIndex('TelephonyCalls', ['clientPhoneNormalized'], {
      name: 'telephony_calls_client_phone_idx',
    });
    await queryInterface.addIndex('TelephonyCalls', ['userId', 'startedAt'], {
      name: 'telephony_calls_user_started_idx',
    });
    await queryInterface.addIndex('TelephonyCalls', ['callStatus', 'processingStatus'], {
      name: 'telephony_calls_status_processing_idx',
    });
    await queryInterface.addIndex('TelephonyCalls', ['startedAt'], {
      name: 'telephony_calls_started_at_idx',
    });
    await queryInterface.addIndex('TelephonyRawEvents', ['eventType'], {
      name: 'telephony_raw_events_type_idx',
    });
    await queryInterface.addIndex('TelephonyRawEvents', ['processingStatus'], {
      name: 'telephony_raw_events_processing_idx',
    });
    await queryInterface.addIndex('TelephonyRawEvents', ['telephonyCallId'], {
      name: 'telephony_raw_events_call_id_idx',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('TelephonyRawEvents', 'telephony_raw_events_call_id_idx');
    await queryInterface.removeIndex('TelephonyRawEvents', 'telephony_raw_events_processing_idx');
    await queryInterface.removeIndex('TelephonyRawEvents', 'telephony_raw_events_type_idx');
    await queryInterface.removeIndex('TelephonyCalls', 'telephony_calls_started_at_idx');
    await queryInterface.removeIndex('TelephonyCalls', 'telephony_calls_status_processing_idx');
    await queryInterface.removeIndex('TelephonyCalls', 'telephony_calls_user_started_idx');
    await queryInterface.removeIndex('TelephonyCalls', 'telephony_calls_client_phone_idx');
    await queryInterface.removeIndex('TelephonyCalls', 'telephony_calls_record_id_idx');
    await queryInterface.removeIndex('TelephonyCalls', 'telephony_calls_external_tracking_id_idx');
    await queryInterface.removeIndex('TelephonyCalls', 'telephony_calls_external_call_id_idx');
    await queryInterface.dropTable('TelephonyRawEvents');
    await queryInterface.dropTable('TelephonyCalls');

    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_TelephonyCalls_provider";');
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_TelephonyCalls_direction";');
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_TelephonyCalls_callStatus";');
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_TelephonyCalls_processingStatus";');
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_TelephonyCalls_recordingStatus";');
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_TelephonyCalls_result";');
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_TelephonyCalls_interest";');
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_TelephonyRawEvents_provider";');
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_TelephonyRawEvents_processingStatus";');
    }
  },
};
