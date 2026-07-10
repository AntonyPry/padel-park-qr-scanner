'use strict';

const INDEX_NAME = 'telephony_transcription_jobs_call_created_id_idx';

module.exports = {
  async up(queryInterface) {
    const indexes = await queryInterface.showIndex('TelephonyTranscriptionJobs');
    if (!indexes.some((index) => index.name === INDEX_NAME)) {
      await queryInterface.addIndex(
        'TelephonyTranscriptionJobs',
        ['telephonyCallId', 'createdAt', 'id'],
        { name: INDEX_NAME },
      );
    }
  },

  async down(queryInterface) {
    const indexes = await queryInterface.showIndex('TelephonyTranscriptionJobs');
    if (indexes.some((index) => index.name === INDEX_NAME)) {
      await queryInterface.removeIndex('TelephonyTranscriptionJobs', INDEX_NAME);
    }
  },
};
