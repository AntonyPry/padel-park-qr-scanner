'use strict';

const path = require('node:path');

const manifestSource = process.env.SETLY_ATTACHMENT_CLI_TEST_MANIFEST;
if (manifestSource) {
  const serverRoot = path.resolve(__dirname, '../..');
  const modelsPath = require.resolve(path.join(serverRoot, 'models'));
  const migrationPath = require.resolve(
    path.join(serverRoot, 'src/files-workers/shift-attachment-migration'),
  );
  const manifest = JSON.parse(manifestSource);

  require.cache[modelsPath] = {
    exports: {
      sequelize: {
        async authenticate() {},
        async close() {},
      },
    },
    filename: modelsPath,
    id: modelsPath,
    loaded: true,
  };
  require.cache[migrationPath] = {
    exports: {
      async migrateShiftReportAttachments() {
        return manifest;
      },
    },
    filename: migrationPath,
    id: migrationPath,
    loaded: true,
  };
}
