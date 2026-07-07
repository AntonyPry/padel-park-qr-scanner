const { spawn } = require('node:child_process');

class CommandError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'CommandError';
    this.code = details.code;
    this.command = details.command;
    this.signal = details.signal;
    this.stderr = details.stderr || '';
    this.stdout = details.stdout || '';
  }
}

function runCommand(command, args = [], options = {}) {
  const timeoutMs = Number(options.timeoutMs || 0);
  const maxBufferBytes = Number(options.maxBufferBytes || 50 * 1024 * 1024);
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let killedByTimeout = false;
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        killedByTimeout = true;
        child.kill('SIGKILL');
      }, timeoutMs);
    }

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length + stderr.length > maxBufferBytes) {
        child.kill('SIGKILL');
        fail(new CommandError(`Command output exceeded ${maxBufferBytes} bytes`, {
          command,
          stderr,
          stdout,
        }));
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stdout.length + stderr.length > maxBufferBytes) {
        child.kill('SIGKILL');
        fail(new CommandError(`Command output exceeded ${maxBufferBytes} bytes`, {
          command,
          stderr,
          stdout,
        }));
      }
    });

    child.on('error', (error) => {
      fail(new CommandError(`${command} failed to start: ${error.message}`, {
        command,
        stderr,
        stdout,
      }));
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();

      if (killedByTimeout) {
        reject(new CommandError(`${command} timed out after ${timeoutMs} ms`, {
          command,
          signal,
          stderr,
          stdout,
        }));
        return;
      }

      if (code !== 0) {
        reject(new CommandError(`${command} exited with code ${code}`, {
          code,
          command,
          signal,
          stderr,
          stdout,
        }));
        return;
      }

      resolve({
        durationMs: Date.now() - startedAt,
        stderr,
        stdout,
      });
    });
  });
}

module.exports = {
  CommandError,
  runCommand,
};
