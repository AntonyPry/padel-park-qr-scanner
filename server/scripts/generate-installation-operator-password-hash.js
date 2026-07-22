#!/usr/bin/env node
'use strict';

const readline = require('node:readline');
const { Writable } = require('node:stream');
const authService = require('../src/services/password-hashing.service');

const MAX_PASSWORD_BYTES = 1024;
const ARGON2_ENV_NAMES = Object.freeze([
  'AUTH_ARGON2_MEMORY_KIB',
  'AUTH_ARGON2_PARALLELISM',
  'AUTH_ARGON2_TIME_COST',
]);

function inputError(message) {
  const error = new Error(message);
  error.code = 'INSTALLATION_OPERATOR_PASSWORD_INPUT_INVALID';
  return error;
}

function validatePasswordInput(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw inputError('Operator password must not be empty');
  }
  if (
    Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES ||
    password.trim() !== password ||
    /[\u0000-\u001f\u007f]/u.test(password)
  ) {
    throw inputError('Operator password contains unsafe input');
  }
  return password;
}

function decodePipedPassword(input) {
  if (!Buffer.isBuffer(input) || input.length > MAX_PASSWORD_BYTES + 2) {
    throw inputError('Operator password contains unsafe input');
  }
  const decoded = input.toString('utf8');
  if (!Buffer.from(decoded, 'utf8').equals(input)) {
    throw inputError('Operator password must be valid UTF-8');
  }
  const withoutTerminator = decoded.endsWith('\r\n')
    ? decoded.slice(0, -2)
    : decoded.endsWith('\n')
      ? decoded.slice(0, -1)
      : decoded;
  return validatePasswordInput(withoutTerminator);
}

async function readPipedPassword(input) {
  const chunks = [];
  let size = 0;
  for await (const chunk of input) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > MAX_PASSWORD_BYTES + 2) {
      throw inputError('Operator password contains unsafe input');
    }
    chunks.push(value);
  }
  return decodePipedPassword(Buffer.concat(chunks));
}

async function readHiddenPassword(input, diagnostics) {
  const mutedOutput = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const prompt = readline.createInterface({
    input,
    output: mutedOutput,
    terminal: true,
  });
  const ask = (message) => new Promise((resolve) => {
    diagnostics.write(message);
    prompt.question('', (answer) => {
      diagnostics.write('\n');
      resolve(answer);
    });
  });
  try {
    const password = validatePasswordInput(
      await ask('Installation operator password: '),
    );
    const confirmation = validatePasswordInput(
      await ask('Confirm installation operator password: '),
    );
    if (password !== confirmation) {
      throw inputError('Operator password confirmation does not match');
    }
    return password;
  } finally {
    prompt.close();
  }
}

function operatorHashEnvironment(env) {
  const selected = { AUTH_ARGON2_ENABLED: 'true' };
  for (const name of ARGON2_ENV_NAMES) {
    if (env[name] !== undefined) selected[name] = env[name];
  }
  return selected;
}

async function generateAndPreflight(password, env = process.env) {
  const validated = validatePasswordInput(password);
  const hashEnvironment = operatorHashEnvironment(env);
  const passwordHash = await authService.hashPassword(validated, hashEnvironment);
  const info = authService.passwordHashInfo(passwordHash, hashEnvironment);
  const verified = await authService.verifyPassword(validated, passwordHash);
  if (info?.scheme !== 'argon2id' || !verified) {
    throw new Error('Installation operator hash preflight failed');
  }
  return passwordHash;
}

async function main({
  argv = process.argv.slice(2),
  diagnostics = process.stderr,
  env = process.env,
  input = process.stdin,
  output = process.stdout,
} = {}) {
  if (argv.length > 0) {
    throw inputError(
      'This command accepts no arguments; use the hidden TTY prompt or standard input',
    );
  }
  const password = input.isTTY
    ? await readHiddenPassword(input, diagnostics)
    : await readPipedPassword(input);
  const passwordHash = await generateAndPreflight(password, env);
  output.write(`${passwordHash}\n`);
  return passwordHash;
}

function safeFailureMessage(error) {
  if (
    error?.code === 'INSTALLATION_OPERATOR_PASSWORD_INPUT_INVALID' ||
    error?.code === 'PASSWORD_HASH_CONFIGURATION_INVALID'
  ) {
    return error.message;
  }
  return 'Installation operator hash generation failed';
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${safeFailureMessage(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  decodePipedPassword,
  generateAndPreflight,
  main,
  operatorHashEnvironment,
  safeFailureMessage,
  validatePasswordInput,
};
