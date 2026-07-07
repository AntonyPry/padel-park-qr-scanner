'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('TelephonyTranscriptionJobs', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      telephonyCallId: {
        allowNull: false,
        references: {
          key: 'id',
          model: 'TelephonyCalls',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        type: Sequelize.INTEGER,
      },
      status: {
        allowNull: false,
        defaultValue: 'queued',
        type: Sequelize.ENUM('queued', 'processing', 'completed', 'failed'),
      },
      language: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      transcriptText: {
        allowNull: true,
        type: Sequelize.TEXT,
      },
      errorMessage: {
        allowNull: true,
        type: Sequelize.TEXT,
      },
      workerId: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      attemptCount: {
        allowNull: false,
        defaultValue: 0,
        type: Sequelize.INTEGER,
      },
      claimedAt: {
        allowNull: true,
        type: Sequelize.DATE,
      },
      completedAt: {
        allowNull: true,
        type: Sequelize.DATE,
      },
      failedAt: {
        allowNull: true,
        type: Sequelize.DATE,
      },
      createdByAccountId: {
        allowNull: true,
        references: {
          key: 'id',
          model: 'Accounts',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        type: Sequelize.INTEGER,
      },
      metadata: {
        allowNull: true,
        type: Sequelize.JSON,
      },
      createdAt: {
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        type: Sequelize.DATE,
      },
    });

    await queryInterface.createTable('TelephonyTranscriptSegments', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      transcriptionJobId: {
        allowNull: false,
        references: {
          key: 'id',
          model: 'TelephonyTranscriptionJobs',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        type: Sequelize.INTEGER,
      },
      telephonyCallId: {
        allowNull: false,
        references: {
          key: 'id',
          model: 'TelephonyCalls',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        type: Sequelize.INTEGER,
      },
      speaker: {
        allowNull: false,
        defaultValue: 'unknown',
        type: Sequelize.ENUM('administrator', 'client', 'unknown'),
      },
      text: {
        allowNull: false,
        type: Sequelize.TEXT,
      },
      startMs: {
        allowNull: true,
        type: Sequelize.INTEGER,
      },
      endMs: {
        allowNull: true,
        type: Sequelize.INTEGER,
      },
      confidence: {
        allowNull: true,
        type: Sequelize.DECIMAL(6, 5),
      },
      sortOrder: {
        allowNull: false,
        defaultValue: 0,
        type: Sequelize.INTEGER,
      },
      createdAt: {
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        type: Sequelize.DATE,
      },
    });

    await queryInterface.addIndex('TelephonyTranscriptionJobs', ['telephonyCallId', 'status'], {
      name: 'telephony_transcription_jobs_call_status_idx',
    });
    await queryInterface.addIndex('TelephonyTranscriptionJobs', ['status', 'createdAt'], {
      name: 'telephony_transcription_jobs_queue_idx',
    });
    await queryInterface.addIndex('TelephonyTranscriptSegments', ['transcriptionJobId', 'sortOrder'], {
      name: 'telephony_transcript_segments_job_order_idx',
    });
    await queryInterface.addIndex('TelephonyTranscriptSegments', ['telephonyCallId'], {
      name: 'telephony_transcript_segments_call_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      'TelephonyTranscriptSegments',
      'telephony_transcript_segments_call_idx',
    );
    await queryInterface.removeIndex(
      'TelephonyTranscriptSegments',
      'telephony_transcript_segments_job_order_idx',
    );
    await queryInterface.removeIndex(
      'TelephonyTranscriptionJobs',
      'telephony_transcription_jobs_queue_idx',
    );
    await queryInterface.removeIndex(
      'TelephonyTranscriptionJobs',
      'telephony_transcription_jobs_call_status_idx',
    );
    await queryInterface.dropTable('TelephonyTranscriptSegments');
    await queryInterface.dropTable('TelephonyTranscriptionJobs');

    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_TelephonyTranscriptSegments_speaker";');
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_TelephonyTranscriptionJobs_status";');
    }
  },
};
