#!/usr/bin/env node
'use strict';

const os = require('node:os');
const { monitorEventLoopDelay, performance } = require('node:perf_hooks');
const authService = require('../src/services/auth.service');

const SAMPLE_INTERVAL_MS = 5;
const DEFAULT_SAMPLES = 12;
const DEFAULT_CONCURRENCY = [1, 4, 8];
const MIB = 1024 * 1024;
const PASSWORD = 'setly-local-password-benchmark-only';

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function summarize(values) {
  return {
    maxMs: Number(Math.max(...values).toFixed(2)),
    p50Ms: Number(percentile(values, 0.5).toFixed(2)),
    p95Ms: Number(percentile(values, 0.95).toFixed(2)),
  };
}

async function measureBatch(work) {
  const beforeRss = process.memoryUsage().rss;
  let peakRss = beforeRss;
  const timer = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, SAMPLE_INTERVAL_MS);
  const startedAt = performance.now();
  const settled = await Promise.allSettled(work.map((operation) => operation()));
  const elapsedMs = performance.now() - startedAt;
  clearInterval(timer);
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  return {
    elapsedMs,
    errors: settled.filter((result) => result.status === 'rejected').length,
    peakRssDeltaMiB: Number(((peakRss - beforeRss) / MIB).toFixed(2)),
  };
}

async function measureSequential(samples, operation) {
  const values = [];
  let peakRssDeltaMiB = 0;
  let errors = 0;
  for (let index = 0; index < samples; index += 1) {
    const measured = await measureBatch([operation]);
    values.push(measured.elapsedMs);
    peakRssDeltaMiB = Math.max(peakRssDeltaMiB, measured.peakRssDeltaMiB);
    errors += measured.errors;
  }
  return { ...summarize(values), errors, peakRssDeltaMiB };
}

async function main() {
  const initialRss = process.memoryUsage().rss;
  const samples = Number(process.env.AUTH_PASSWORD_BENCHMARK_SAMPLES || DEFAULT_SAMPLES);
  if (!Number.isInteger(samples) || samples < 3 || samples > 100) {
    throw new Error('AUTH_PASSWORD_BENCHMARK_SAMPLES must be an integer from 3 to 100');
  }
  const configured = authService._private.passwordHashingConfiguration({
    AUTH_ARGON2_ENABLED: 'true',
    AUTH_ARGON2_MEMORY_KIB:
      process.env.AUTH_ARGON2_MEMORY_KIB || String(authService._private.ARGON2_DEFAULTS.memoryCost),
    AUTH_ARGON2_PARALLELISM:
      process.env.AUTH_ARGON2_PARALLELISM || String(authService._private.ARGON2_DEFAULTS.parallelism),
    AUTH_ARGON2_TIME_COST:
      process.env.AUTH_ARGON2_TIME_COST || String(authService._private.ARGON2_DEFAULTS.timeCost),
  });
  const env = {
    AUTH_ARGON2_ENABLED: 'true',
    AUTH_ARGON2_MEMORY_KIB: String(configured.memoryCost),
    AUTH_ARGON2_PARALLELISM: String(configured.parallelism),
    AUTH_ARGON2_TIME_COST: String(configured.timeCost),
  };
  const legacyHash = await authService._private.hashLegacyPassword(PASSWORD);
  const argonHash = await authService._private.hashArgon2idPassword(PASSWORD, env);

  const loopDelay = monitorEventLoopDelay({ resolution: 10 });
  loopDelay.enable();
  const sequential = {
    argonHash: await measureSequential(samples, () =>
      authService._private.hashArgon2idPassword(PASSWORD, env)),
    argonVerify: await measureSequential(samples, () =>
      authService.verifyPassword(PASSWORD, argonHash)),
    legacyVerify: await measureSequential(samples, () =>
      authService.verifyPassword(PASSWORD, legacyHash)),
  };
  const concurrency = [];
  for (const width of DEFAULT_CONCURRENCY) {
    const hash = await measureBatch(
      Array.from({ length: width }, () => () =>
        authService._private.hashArgon2idPassword(PASSWORD, env)),
    );
    const loginRehash = await measureBatch(
      Array.from({ length: width }, () => async () => {
        if (!(await authService.verifyPassword(PASSWORD, legacyHash))) {
          throw new Error('Legacy benchmark verification failed');
        }
        await authService._private.hashArgon2idPassword(PASSWORD, env);
      }),
    );
    concurrency.push({
      concurrentOperations: width,
      hashBatchMs: Number(hash.elapsedMs.toFixed(2)),
      hashErrors: hash.errors,
      hashPeakRssDeltaMiB: hash.peakRssDeltaMiB,
      loginRehashBatchMs: Number(loginRehash.elapsedMs.toFixed(2)),
      loginRehashErrors: loginRehash.errors,
      loginRehashPeakRssDeltaMiB: loginRehash.peakRssDeltaMiB,
    });
  }
  loopDelay.disable();
  const result = {
    evidenceClass: 'local-non-production',
    runtime: {
      arch: process.arch,
      cpuCount: os.cpus().length,
      node: process.version,
      platform: `${process.platform} ${os.release()}`,
      totalMemoryMiB: Math.round(os.totalmem() / MIB),
      uvThreadpoolSize: process.env.UV_THREADPOOL_SIZE || 'default',
    },
    parameters: {
      memoryCostKiB: configured.memoryCost,
      parallelism: configured.parallelism,
      timeCost: configured.timeCost,
      version: 19,
    },
    samples,
    sequential,
    concurrency,
    eventLoopDelayP99Ms: Number((loopDelay.percentile(99) / 1e6).toFixed(2)),
    processMemory: {
      baselineRssMiB: Number((initialRss / MIB).toFixed(2)),
      peakRssDeltaMiB: Number(
        ((process.resourceUsage().maxRSS * 1024 - initialRss) / MIB).toFixed(2),
      ),
      peakRssMiB: Number((process.resourceUsage().maxRSS / 1024).toFixed(2)),
    },
    phcLength: argonHash.length,
  };
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
