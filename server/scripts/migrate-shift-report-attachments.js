#!/usr/bin/env node
'use strict';

require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const db = require('../models');
const {
  migrateShiftReportAttachments,
} = require('../src/files-workers/shift-attachment-migration');

const ATTACHMENT_CLI_OPTIONS = Object.freeze(['apply', 'output', 'rollback']);

function cliError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseArgs(argv) {
  const options = { apply: false, output: null, rollback: false };
  const seen = new Set();
  for (const value of argv) {
    let key;
    let parsedValue = true;
    if (value === '--apply' || value === '--rollback') {
      key = value.slice(2);
    } else if (value.startsWith('--output=')) {
      key = 'output';
      parsedValue = value.slice('--output='.length);
      if (!parsedValue) {
        throw cliError('--output requires a non-empty path', 'ATTACHMENT_CLI_OUTPUT_REQUIRED');
      }
    } else {
      throw cliError(
        `Unsupported attachment migration argument: ${value}`,
        'ATTACHMENT_CLI_ARGUMENT_UNSUPPORTED',
      );
    }
    if (seen.has(key)) {
      throw cliError(`Duplicate --${key} argument`, 'ATTACHMENT_CLI_ARGUMENT_DUPLICATE');
    }
    seen.add(key);
    options[key] = parsedValue;
  }
  if (options.apply && options.rollback) {
    throw new Error('Use either --apply or --rollback, not both');
  }
  return options;
}

async function lstatIfExists(targetPath) {
  try {
    return await fsp.lstat(targetPath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function refuseExistingOutput(targetPath, stat) {
  if (stat.isSymbolicLink()) {
    throw cliError(
      `Attachment manifest output must not be a symlink: ${targetPath}`,
      'ATTACHMENT_CLI_OUTPUT_SYMLINK',
    );
  }
  if (!stat.isFile()) {
    throw cliError(
      `Attachment manifest output must be a new regular file: ${targetPath}`,
      'ATTACHMENT_CLI_OUTPUT_NON_REGULAR',
    );
  }
  throw cliError(
    `Attachment manifest output already exists: ${targetPath}`,
    'ATTACHMENT_CLI_OUTPUT_EXISTS',
  );
}

function sameFileIdentity(left, right) {
  return Boolean(left && right) &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.uid === right.uid &&
    left.gid === right.gid;
}

function temporaryOutputPath(destination, kind) {
  return path.join(
    destination.parentPath,
    `.${path.basename(destination.absolutePath)}.${process.pid}.${crypto.randomUUID()}.${kind}`,
  );
}

async function syncDirectory(directoryPath) {
  const handle = await fsp.open(directoryPath, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function assertOutputDestination(outputPath) {
  const absolutePath = path.resolve(outputPath);
  const parentPath = path.dirname(absolutePath);
  const parentStat = await lstatIfExists(parentPath);
  if (!parentStat) {
    throw cliError(
      `Attachment manifest parent directory does not exist: ${parentPath}`,
      'ATTACHMENT_CLI_OUTPUT_PARENT_MISSING',
    );
  }
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    throw cliError(
      `Attachment manifest parent must be a real directory: ${parentPath}`,
      'ATTACHMENT_CLI_OUTPUT_PARENT_UNSAFE',
    );
  }
  try {
    await fsp.access(parentPath, fs.constants.W_OK | fs.constants.X_OK);
  } catch {
    throw cliError(
      `Attachment manifest parent is not writable: ${parentPath}`,
      'ATTACHMENT_CLI_OUTPUT_PARENT_NOT_WRITABLE',
    );
  }
  const targetStat = await lstatIfExists(absolutePath);
  if (targetStat) refuseExistingOutput(absolutePath, targetStat);
  return { absolutePath, parentPath, parentStat };
}

async function assertParentUnchanged(reservation) {
  const currentParent = await fsp.lstat(reservation.parentPath);
  if (
    currentParent.isSymbolicLink() ||
    !currentParent.isDirectory() ||
    !sameFileIdentity(currentParent, reservation.parentStat)
  ) {
    throw cliError(
      'Attachment manifest parent changed during output publication',
      'ATTACHMENT_CLI_OUTPUT_PARENT_CHANGED',
    );
  }
  try {
    await fsp.access(reservation.parentPath, fs.constants.W_OK | fs.constants.X_OK);
  } catch {
    throw cliError(
      `Attachment manifest parent is no longer writable: ${reservation.parentPath}`,
      'ATTACHMENT_CLI_OUTPUT_PARENT_NOT_WRITABLE',
    );
  }
  return currentParent;
}

async function assertReservationOwned(reservation) {
  const [currentTarget, heldReservation] = await Promise.all([
    lstatIfExists(reservation.absolutePath),
    reservation.handle.stat(),
  ]);
  if (
    !currentTarget ||
    currentTarget.isSymbolicLink() ||
    !currentTarget.isFile() ||
    !sameFileIdentity(currentTarget, heldReservation) ||
    !sameFileIdentity(currentTarget, reservation.reservationStat)
  ) {
    throw cliError(
      'Attachment manifest output reservation changed before publication',
      'ATTACHMENT_CLI_OUTPUT_RESERVATION_CHANGED',
    );
  }
  return currentTarget;
}

async function releaseOutputReservation(reservation) {
  if (!reservation) return;
  try {
    if (!reservation.published) {
      const [currentTarget, heldReservation] = await Promise.all([
        lstatIfExists(reservation.absolutePath),
        reservation.handle.stat(),
      ]);
      if (sameFileIdentity(currentTarget, heldReservation)) {
        await fsp.unlink(reservation.absolutePath);
        await syncDirectory(reservation.parentPath).catch(() => {});
      }
    }
  } finally {
    await reservation.handle.close().catch(() => {});
  }
}

async function reserveOutputDestination(outputPath) {
  const destination = await assertOutputDestination(outputPath);
  const token = crypto.randomUUID();
  const temporaryPath = temporaryOutputPath(destination, 'reservation');
  let handle;
  let linked = false;
  try {
    const flags = fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      fs.constants.O_WRONLY |
      (fs.constants.O_NOFOLLOW || 0);
    handle = await fsp.open(temporaryPath, flags, 0o600);
    await handle.writeFile(`${JSON.stringify({
      pid: process.pid,
      schema: 'setly.attachment-manifest-output-reservation',
      token,
    })}\n`, 'utf8');
    await handle.sync();
    await assertParentUnchanged(destination);
    try {
      await fsp.link(temporaryPath, destination.absolutePath);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const targetStat = await fsp.lstat(destination.absolutePath);
      refuseExistingOutput(destination.absolutePath, targetStat);
    }
    linked = true;
    await fsp.unlink(temporaryPath);
    const reservation = {
      ...destination,
      handle,
      published: false,
      reservationStat: await handle.stat(),
      token,
    };
    await assertReservationOwned(reservation);
    await syncDirectory(destination.parentPath);
    return reservation;
  } catch (error) {
    if (linked && handle) {
      const currentTarget = await lstatIfExists(destination.absolutePath);
      const heldReservation = await handle.stat().catch(() => null);
      if (sameFileIdentity(currentTarget, heldReservation)) {
        await fsp.unlink(destination.absolutePath).catch(() => {});
      }
    }
    await handle?.close().catch(() => {});
    throw error;
  } finally {
    await fsp.unlink(temporaryPath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

async function publishReservedManifest(reservation, manifest) {
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  const temporaryPath = temporaryOutputPath(reservation, 'manifest');
  let handle;
  try {
    const flags = fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      fs.constants.O_WRONLY |
      (fs.constants.O_NOFOLLOW || 0);
    handle = await fsp.open(temporaryPath, flags, 0o600);
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;

    await assertParentUnchanged(reservation);
    await assertReservationOwned(reservation);
    await fsp.rename(temporaryPath, reservation.absolutePath);
    reservation.published = true;
    await syncDirectory(reservation.parentPath);
    return reservation.absolutePath;
  } finally {
    await handle?.close().catch(() => {});
    await fsp.unlink(temporaryPath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

async function atomicWriteManifest(outputPath, manifest) {
  const reservation = await reserveOutputDestination(outputPath);
  try {
    return await publishReservedManifest(reservation, manifest);
  } finally {
    await releaseOutputReservation(reservation);
  }
}

function isUnsafeManifest(manifest) {
  return manifest.counts.checksumMismatch > 0 ||
    manifest.counts.invalidMetadata > 0 ||
    manifest.counts.missingLegacy > 0 ||
    manifest.counts.missingStorage > 0;
}

async function main({
  argv = process.argv.slice(2),
  migrate = migrateShiftReportAttachments,
  sequelize = db.sequelize,
  stdout = process.stdout,
} = {}) {
  const options = parseArgs(argv);
  const reservation = options.output
    ? await reserveOutputDestination(options.output)
    : null;
  try {
    await sequelize.authenticate();
    const manifest = await migrate({
      apply: options.apply,
      rollback: options.rollback,
    });
    if (reservation) await publishReservedManifest(reservation, manifest);
    stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return isUnsafeManifest(manifest) ? 2 : 0;
  } finally {
    await releaseOutputReservation(reservation);
  }
}

if (require.main === module) {
  main()
    .then((exitCode) => {
      if (exitCode) process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(error.code || error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.sequelize.close().catch(() => {});
    });
}

module.exports = {
  ATTACHMENT_CLI_OPTIONS,
  assertOutputDestination,
  atomicWriteManifest,
  isUnsafeManifest,
  main,
  parseArgs,
  publishReservedManifest,
  releaseOutputReservation,
  reserveOutputDestination,
};
