import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPendingScannerScan,
  recordPendingScannerRetry,
} from './scanner-scan-queue';
import {
  WebSerialScannerLifecycle,
  type ScannerDiagnosticEvent,
  type ScannerLifecycleSnapshot,
  type SerialPortLike,
  type SerialProviderLike,
} from './web-serial-scanner';

type ReadResult = ReadableStreamReadResult<Uint8Array>;

class ControlledReader {
  private pending:
    | {
        reject: (reason?: unknown) => void;
        resolve: (result: ReadResult) => void;
      }
    | undefined;
  private queued:
    | { kind: 'data'; value: Uint8Array }
    | { kind: 'done' }
    | { error: unknown; kind: 'error' }
    | undefined;

  readonly cancel = vi.fn(async () => {
    this.finish();
  });
  readonly read = vi.fn(() => {
    if (this.queued) {
      const queued = this.queued;
      this.queued = undefined;
      if (queued.kind === 'error') return Promise.reject(queued.error);
      if (queued.kind === 'done') {
        return Promise.resolve({ done: true, value: undefined });
      }
      return Promise.resolve({ done: false, value: queued.value });
    }

    return new Promise<ReadResult>((resolve, reject) => {
      this.pending = { reject, resolve };
    });
  });
  readonly releaseLock = vi.fn();

  push(value: Uint8Array) {
    if (this.pending) {
      const { resolve } = this.pending;
      this.pending = undefined;
      resolve({ done: false, value });
      return;
    }
    this.queued = { kind: 'data', value };
  }

  fail(error: unknown) {
    if (this.pending) {
      const { reject } = this.pending;
      this.pending = undefined;
      reject(error);
      return;
    }
    this.queued = { error, kind: 'error' };
  }

  finish() {
    if (this.pending) {
      const { resolve } = this.pending;
      this.pending = undefined;
      resolve({ done: true, value: undefined });
      return;
    }
    this.queued = { kind: 'done' };
  }
}

class MockSerialPort implements SerialPortLike {
  readable: ReadableStream<Uint8Array> | null = null;
  readonly readers: ControlledReader[] = [];
  onOpen?: (reader: ControlledReader, openIndex: number) => void;

  readonly close = vi.fn(async (): Promise<void> => undefined);
  readonly getInfo = vi.fn(() => ({
    usbProductId: 222,
    usbVendorId: 111,
  }));
  readonly open = vi.fn(async () => {
    const reader = new ControlledReader();
    const getReader = vi.fn(() => reader);
    this.readers.push(reader);
    this.readable = { getReader } as unknown as ReadableStream<Uint8Array>;
    this.onOpen?.(reader, this.readers.length - 1);
  });

  get activeReader() {
    return this.readers.at(-1);
  }
}

class MockSerialProvider implements SerialProviderLike {
  ports: SerialPortLike[];
  requestPorts: SerialPortLike[];
  private readonly disconnectListeners = new Set<(event: Event) => void>();

  constructor(port: SerialPortLike) {
    this.ports = [port];
    this.requestPorts = [port];
  }

  readonly addEventListener = vi.fn(
    (_type: 'disconnect', listener: (event: Event) => void) => {
      this.disconnectListeners.add(listener);
    },
  );
  readonly getPorts = vi.fn(async () => this.ports);
  readonly removeEventListener = vi.fn(
    (_type: 'disconnect', listener: (event: Event) => void) => {
      this.disconnectListeners.delete(listener);
    },
  );
  readonly requestPort = vi.fn(async () => {
    const port = this.requestPorts.shift();
    if (!port) throw new DOMException('No port selected', 'NotFoundError');
    return port;
  });

  emitDisconnect(port: SerialPortLike) {
    const event = new Event('disconnect');
    Object.defineProperty(event, 'target', { value: port });
    for (const listener of this.disconnectListeners) listener(event);
  }
}

interface HarnessOptions {
  maxReconnectAttempts?: number;
  onDiagnostic?: (event: ScannerDiagnosticEvent) => void | Promise<void>;
  onScan?: (qrCode: string) => void;
  port?: MockSerialPort;
  provider?: MockSerialProvider;
}

function createHarness(options: HarnessOptions = {}) {
  const port = options.port ?? new MockSerialPort();
  const provider = options.provider ?? new MockSerialProvider(port);
  const events: ScannerDiagnosticEvent[] = [];
  const scans: string[] = [];
  const snapshots: ScannerLifecycleSnapshot[] = [];
  const lifecycle = new WebSerialScannerLifecycle({
    maxReconnectAttempts: options.maxReconnectAttempts ?? 3,
    onDiagnostic: async (event) => {
      events.push(event);
      await options.onDiagnostic?.(event);
    },
    onScan: options.onScan ?? ((qrCode) => scans.push(qrCode)),
    onStateChange: (snapshot) => snapshots.push(snapshot),
    reconnectDelayMs: () => 10,
    serial: provider,
    stableAfterMs: 60_000,
  });

  return { events, lifecycle, port, provider, scans, snapshots };
}

async function flushPromises() {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve();
  }
}

function readerFailure() {
  return new DOMException('The device has been lost.', 'NetworkError');
}

describe('WebSerialScannerLifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens the port and proves stability after a successful byte/read', async () => {
    const harness = createHarness();

    await harness.lifecycle.connectManually();
    harness.port.activeReader?.push(new TextEncoder().encode('ticket-1\r\n'));
    await flushPromises();

    expect(harness.port.open).toHaveBeenCalledWith({ baudRate: 9600 });
    expect(harness.scans).toEqual(['ticket-1']);
    expect(harness.lifecycle.state).toMatchObject({
      reconnectAttempt: 0,
      status: 'connected',
    });
    expect(harness.lifecycle.state.lastReason?.code).toBe('data_read');

    await harness.lifecycle.dispose();
  });

  it('automatically opens the only previously allowed port after reload', async () => {
    const harness = createHarness();

    await harness.lifecycle.start();
    await flushPromises();

    expect(harness.provider.getPorts).toHaveBeenCalledTimes(1);
    expect(harness.provider.requestPort).not.toHaveBeenCalled();
    expect(harness.port.open).toHaveBeenCalledTimes(1);
    expect(harness.lifecycle.state.status).toBe('connected');

    await harness.lifecycle.dispose();
  });

  it('processes 20 sequential scans without losing or duplicating QR values', async () => {
    const harness = createHarness();
    await harness.lifecycle.connectManually();

    for (let index = 1; index <= 20; index += 1) {
      harness.port.activeReader?.push(
        new TextEncoder().encode(`ticket-${index}\n`),
      );
      await flushPromises();
    }

    expect(harness.scans).toEqual(
      Array.from({ length: 20 }, (_, index) => `ticket-${index + 1}`),
    );
    expect(harness.lifecycle.state.status).toBe('connected');

    await harness.lifecycle.dispose();
  });

  it('shows a classified terminal reason when port.open rejects', async () => {
    const port = new MockSerialPort();
    port.open.mockRejectedValueOnce(
      new DOMException('The port is already open.', 'InvalidStateError'),
    );
    const harness = createHarness({ port });

    await harness.lifecycle.connectManually();
    await flushPromises();

    expect(harness.lifecycle.state.status).toBe('terminal');
    expect(harness.lifecycle.state.lastReason?.code).toBe('port_busy');
    expect(harness.lifecycle.state.lastReason?.message).toContain(
      'другой вкладке или программе',
    );

    await harness.lifecycle.dispose();
  });

  it('stops repeated open-success/reader-failure flapping at the circuit breaker', async () => {
    const port = new MockSerialPort();
    port.onOpen = (reader) => queueMicrotask(() => reader.fail(readerFailure()));
    const harness = createHarness({ maxReconnectAttempts: 3, port });

    await harness.lifecycle.connectManually();
    await flushPromises();
    await vi.runAllTimersAsync();
    await flushPromises();

    expect(port.open).toHaveBeenCalledTimes(4);
    expect(harness.lifecycle.state.status).toBe('terminal');
    expect(harness.lifecycle.state.lastReason?.code).toBe(
      'device_communication_error',
    );
    expect(
      harness.events
        .filter((event) => event.eventType === 'client_reconnect_scheduled')
        .map((event) => event.metadata.attempt),
    ).toEqual([1, 2, 3]);

    await harness.lifecycle.dispose();
  });

  it('does not reset instability merely because port.open succeeds', async () => {
    const port = new MockSerialPort();
    port.onOpen = (reader) => queueMicrotask(() => reader.fail(readerFailure()));
    const harness = createHarness({ maxReconnectAttempts: 2, port });

    await harness.lifecycle.connectManually();
    await flushPromises();
    await vi.runAllTimersAsync();
    await flushPromises();

    expect(
      harness.events
        .filter((event) => event.eventType === 'client_connected')
        .map((event) => event.metadata.attempt),
    ).toEqual([0, 1, 2]);
    expect(harness.lifecycle.state.status).toBe('terminal');

    await harness.lifecycle.dispose();
  });

  it('resets instability only after real data proves a healthy connection', async () => {
    const port = new MockSerialPort();
    port.onOpen = (reader, openIndex) => {
      if (openIndex === 0) {
        queueMicrotask(() => reader.fail(readerFailure()));
      }
    };
    const harness = createHarness({ port });

    await harness.lifecycle.connectManually();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(10);
    await flushPromises();
    expect(harness.lifecycle.state.reconnectAttempt).toBe(1);

    port.activeReader?.push(new TextEncoder().encode('ticket-2\n'));
    await flushPromises();
    expect(harness.lifecycle.state.reconnectAttempt).toBe(0);

    port.activeReader?.fail(readerFailure());
    await flushPromises();
    expect(harness.lifecycle.state).toMatchObject({
      reconnectAttempt: 1,
      status: 'reconnecting',
    });

    await harness.lifecycle.dispose();
  });

  it('coalesces a disconnect event and reader rejection into one reconnect', async () => {
    const harness = createHarness();
    await harness.lifecycle.start();

    harness.provider.emitDisconnect(harness.port);
    harness.port.activeReader?.fail(readerFailure());
    await flushPromises();

    expect(
      harness.events.filter(
        (event) => event.eventType === 'client_reconnect_scheduled',
      ),
    ).toHaveLength(1);
    expect(
      harness.events.filter(
        (event) =>
          event.eventType === 'client_disconnected' ||
          event.eventType === 'client_reader_error',
      ),
    ).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);

    await harness.lifecycle.dispose();
  });

  it('never reconnects after a manual disconnect', async () => {
    const harness = createHarness();
    await harness.lifecycle.connectManually();

    await harness.lifecycle.disconnectManually();
    harness.port.activeReader?.fail(readerFailure());
    await vi.runAllTimersAsync();
    await flushPromises();

    expect(harness.port.open).toHaveBeenCalledTimes(1);
    expect(harness.lifecycle.state).toMatchObject({
      reconnectAttempt: 0,
      status: 'disconnected',
    });
    expect(harness.lifecycle.state.lastReason?.code).toBe('manual_disconnect');

    await harness.lifecycle.dispose();
  });

  it('does not let a stale run close a newly selected port', async () => {
    const oldPort = new MockSerialPort();
    const newPort = new MockSerialPort();
    const provider = new MockSerialProvider(oldPort);
    provider.requestPorts = [oldPort, newPort];
    provider.ports = [oldPort, newPort];
    const harness = createHarness({ port: oldPort, provider });

    await harness.lifecycle.connectManually();
    const oldReader = oldPort.activeReader;
    await harness.lifecycle.connectManually();
    oldReader?.fail(readerFailure());
    await flushPromises();

    expect(newPort.close).not.toHaveBeenCalled();
    expect(harness.lifecycle.state.status).toBe('connected');
    expect(harness.lifecycle.deviceLabel).toBe('USB 111:222');

    await harness.lifecycle.dispose();
  });

  it('serializes old-port cleanup before opening a replacement port', async () => {
    const oldPort = new MockSerialPort();
    const newPort = new MockSerialPort();
    const provider = new MockSerialProvider(oldPort);
    provider.requestPorts = [oldPort, newPort];
    let finishClose: () => void = () => undefined;
    oldPort.close.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishClose = resolve;
        }),
    );
    const harness = createHarness({ port: oldPort, provider });

    await harness.lifecycle.connectManually();
    const replacement = harness.lifecycle.connectManually();
    await flushPromises();
    expect(newPort.open).not.toHaveBeenCalled();

    finishClose();
    await replacement;
    expect(newPort.open).toHaveBeenCalledTimes(1);
    expect(harness.lifecycle.state.status).toBe('connected');

    await harness.lifecycle.dispose();
  });

  it('cleans up on navigation and can start a fresh lifecycle instance', async () => {
    const port = new MockSerialPort();
    const provider = new MockSerialProvider(port);
    const first = createHarness({ port, provider });
    await first.lifecycle.connectManually();
    await first.lifecycle.dispose();

    const second = createHarness({ port, provider });
    await second.lifecycle.start();
    await flushPromises();

    expect(provider.removeEventListener).toHaveBeenCalledTimes(1);
    expect(port.close).toHaveBeenCalledTimes(1);
    expect(port.open).toHaveBeenCalledTimes(2);
    expect(second.lifecycle.state.status).toBe('connected');

    await second.lifecycle.dispose();
  });

  it('classifies EOF once instead of reacquiring readers in a busy loop', async () => {
    const harness = createHarness();
    await harness.lifecycle.connectManually();
    const readable = harness.port.readable as unknown as {
      getReader: ReturnType<typeof vi.fn>;
    };

    harness.port.activeReader?.finish();
    await flushPromises();

    expect(readable.getReader).toHaveBeenCalledTimes(1);
    expect(harness.lifecycle.state.lastReason?.code).toBe('stream_ended');
    expect(
      harness.events.filter(
        (event) => event.eventType === 'client_reconnect_scheduled',
      ),
    ).toHaveLength(1);

    await harness.lifecycle.dispose();
  });

  it('keeps exactly one reconnect timer for one physical incident', async () => {
    const harness = createHarness();
    await harness.lifecycle.start();

    harness.provider.emitDisconnect(harness.port);
    harness.provider.emitDisconnect(harness.port);
    harness.port.activeReader?.fail(readerFailure());
    await flushPromises();

    expect(vi.getTimerCount()).toBe(1);
    expect(harness.lifecycle.state.reconnectAttempt).toBe(1);

    await harness.lifecycle.dispose();
  });

  it('ends with a classified reason when the known port remains absent', async () => {
    const port = new MockSerialPort();
    const provider = new MockSerialProvider(port);
    port.onOpen = (reader) => {
      provider.ports = [];
      queueMicrotask(() => reader.fail(readerFailure()));
    };
    const harness = createHarness({
      maxReconnectAttempts: 2,
      port,
      provider,
    });

    await harness.lifecycle.connectManually();
    await flushPromises();
    await vi.runAllTimersAsync();
    await flushPromises();

    expect(harness.lifecycle.state.status).toBe('terminal');
    expect(harness.lifecycle.state.lastReason?.code).toBe(
      'known_port_unavailable',
    );
    expect(
      harness.events.find(
        (event) =>
          event.code === 'reconnect_limit_reached' &&
          event.status === 'terminal',
      )?.metadata.lastErrorCode,
    ).toBe('known_port_unavailable');

    await harness.lifecycle.dispose();
  });

  it('requires manual selection when identical known ports are ambiguous', async () => {
    const selectedPort = new MockSerialPort();
    const provider = new MockSerialProvider(selectedPort);
    const duplicateA = new MockSerialPort();
    const duplicateB = new MockSerialPort();
    selectedPort.onOpen = (reader) => {
      provider.ports = [duplicateA, duplicateB];
      queueMicrotask(() => reader.fail(readerFailure()));
    };
    const harness = createHarness({ port: selectedPort, provider });

    await harness.lifecycle.connectManually();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(10);
    await flushPromises();

    expect(harness.lifecycle.state.status).toBe('terminal');
    expect(harness.lifecycle.state.lastReason?.code).toBe(
      'known_port_ambiguous',
    );

    await harness.lifecycle.dispose();
  });

  it('keeps serial connected when scan submission fails and retries the same clientEventId', async () => {
    const queued = createPendingScannerScan('ticket-network', () => 'scan-123');
    const submitScan = vi.fn().mockRejectedValue(new Error('Network offline'));
    const harness = createHarness({
      onScan: (qrCode) => {
        void submitScan(qrCode, queued.clientEventId).catch(() => {
          recordPendingScannerRetry(queued);
        });
      },
    });

    await harness.lifecycle.connectManually();
    harness.port.activeReader?.push(
      new TextEncoder().encode('ticket-network\n'),
    );
    await flushPromises();

    expect(harness.lifecycle.state.status).toBe('connected');
    expect(queued).toMatchObject({ attempts: 1, clientEventId: 'scan-123' });
    expect(submitScan).toHaveBeenCalledWith('ticket-network', 'scan-123');

    await harness.lifecycle.dispose();
  });

  it('does not let diagnostic network failure alter the serial state', async () => {
    const harness = createHarness({
      onDiagnostic: async () => {
        throw new Error('Diagnostic API unavailable');
      },
    });

    await harness.lifecycle.connectManually();
    await flushPromises();

    expect(harness.lifecycle.state.status).toBe('connected');
    expect(harness.port.open).toHaveBeenCalledTimes(1);

    await harness.lifecycle.dispose();
  });

  it('does not classify a scan-queue callback failure as a serial failure', async () => {
    const harness = createHarness({
      onScan: () => {
        throw new Error('Queue unavailable');
      },
    });

    await harness.lifecycle.connectManually();
    harness.port.activeReader?.push(new TextEncoder().encode('ticket-queue\n'));
    await flushPromises();

    expect(harness.lifecycle.state.status).toBe('connected');
    expect(
      harness.events.find((event) => event.code === 'scan_enqueue_failed'),
    ).toMatchObject({
      eventType: 'client_scan_submit_failed',
      status: 'failed',
    });
    expect(
      harness.events.filter(
        (event) => event.eventType === 'client_reconnect_scheduled',
      ),
    ).toHaveLength(0);

    await harness.lifecycle.dispose();
  });
});
