export type ScannerLifecycleStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'terminal';

export interface SerialPortLike {
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  getInfo?: () => {
    usbVendorId?: number;
    usbProductId?: number;
  };
}

export interface SerialProviderLike {
  requestPort: () => Promise<SerialPortLike>;
  getPorts?: () => Promise<SerialPortLike[]>;
  addEventListener?: (
    type: 'disconnect',
    listener: (event: Event) => void,
  ) => void;
  removeEventListener?: (
    type: 'disconnect',
    listener: (event: Event) => void,
  ) => void;
}

export interface ScannerLifecycleReason {
  at: string;
  code: string;
  message: string;
  title: string;
}

export interface ScannerLifecycleSnapshot {
  lastReason: ScannerLifecycleReason | null;
  reconnectAttempt: number;
  status: ScannerLifecycleStatus;
}

export interface ScannerDiagnosticEvent {
  code?: string;
  eventType: string;
  message: string;
  metadata: Record<string, unknown>;
  severity: 'info' | 'warning' | 'error';
  status: string;
}

interface ScannerRun {
  failed: boolean;
  healthy: boolean;
  id: number;
  openedAt: number;
  port: SerialPortLike;
  reader: ReadableStreamDefaultReader<Uint8Array> | null;
}

interface FailureDetails {
  browserMessage?: string;
  code: string;
  errorName?: string;
  eventType: 'client_disconnected' | 'client_reader_error';
  message: string;
  title: string;
  trigger: 'hardware_disconnect' | 'reader_error' | 'stream_ended';
}

interface KnownPortResult {
  code?: 'known_port_ambiguous' | 'known_port_unavailable';
  message?: string;
  port: SerialPortLike | null;
}

export interface WebSerialScannerOptions {
  baudRate?: number;
  createSessionId?: () => string;
  maxReconnectAttempts?: number;
  now?: () => number;
  onDiagnostic?: (event: ScannerDiagnosticEvent) => void | Promise<void>;
  onError?: (title: string, message: string) => void;
  onScan: (qrCode: string) => void;
  onSessionChange?: (sessionId: string) => void;
  onStateChange: (snapshot: ScannerLifecycleSnapshot) => void;
  reconnectDelayMs?: (attempt: number) => number;
  serial: SerialProviderLike;
  stableAfterMs?: number;
}

const DEFAULT_MAX_RECONNECT_ATTEMPTS = 8;
const DEFAULT_STABLE_AFTER_MS = 30_000;

function defaultSessionId() {
  const randomPart =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `session-${randomPart}`;
}

export function getSerialDeviceLabel(port: SerialPortLike | null) {
  const info = port?.getInfo?.();
  if (!info?.usbVendorId && !info?.usbProductId) return 'Web Serial';
  return `USB ${info.usbVendorId || '-'}:${info.usbProductId || '-'}`;
}

export function getSerialPortFingerprint(port: SerialPortLike | null) {
  const info = port?.getInfo?.();
  if (!info?.usbVendorId && !info?.usbProductId) return 'web-serial';
  return `${info.usbVendorId || 'unknown'}:${info.usbProductId || 'unknown'}`;
}

export function createInitialScannerSnapshot(): ScannerLifecycleSnapshot {
  return {
    lastReason: null,
    reconnectAttempt: 0,
    status: 'disconnected',
  };
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function classifyOpenError(error: unknown) {
  const name = error instanceof DOMException ? error.name : '';
  const browserMessage = getErrorMessage(
    error,
    'Не удалось открыть Web Serial порт',
  );

  if (name === 'InvalidStateError') {
    return {
      browserMessage,
      code: 'port_busy',
      message: 'Порт уже открыт в другой вкладке или программе.',
      title: 'Порт сканера занят',
    };
  }
  if (name === 'NotFoundError') {
    return {
      browserMessage,
      code: 'port_not_selected',
      message: 'Выбор Web Serial устройства отменён.',
      title: 'Порт сканера не выбран',
    };
  }
  if (name === 'NetworkError') {
    return {
      browserMessage,
      code: 'device_communication_error',
      message:
        'Chrome не смог связаться с USB-устройством. Проверьте кабель, питание и подключение напрямую.',
      title: 'Нет связи со сканером',
    };
  }
  if (name === 'SecurityError') {
    return {
      browserMessage,
      code: 'serial_permission_denied',
      message: 'Браузер не дал странице разрешение на Web Serial устройство.',
      title: 'Нет разрешения на сканер',
    };
  }

  return {
    browserMessage,
    code: 'port_open_failed',
    message: 'Chrome не смог открыть выбранный Web Serial порт.',
    title: 'Не удалось открыть сканер',
  };
}

export class WebSerialScannerLifecycle {
  private readonly baudRate: number;
  private readonly createSessionId: () => string;
  private readonly maxReconnectAttempts: number;
  private readonly now: () => number;
  private readonly onDiagnostic?: WebSerialScannerOptions['onDiagnostic'];
  private readonly onError?: WebSerialScannerOptions['onError'];
  private readonly onScan: WebSerialScannerOptions['onScan'];
  private readonly onSessionChange?: WebSerialScannerOptions['onSessionChange'];
  private readonly onStateChange: WebSerialScannerOptions['onStateChange'];
  private readonly reconnectDelayMs: (attempt: number) => number;
  private readonly serial: SerialProviderLike;
  private readonly stableAfterMs: number;

  private currentRun: ScannerRun | null = null;
  private disposed = false;
  private epoch = 0;
  private intentionalDisconnect = false;
  private operation: Promise<void> = Promise.resolve();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private runSequence = 0;
  private selectedFingerprint: string | null = null;
  private selectedPort: SerialPortLike | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshot = createInitialScannerSnapshot();

  constructor(options: WebSerialScannerOptions) {
    this.baudRate = options.baudRate ?? 9600;
    this.createSessionId = options.createSessionId ?? defaultSessionId;
    this.maxReconnectAttempts =
      options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
    this.now = options.now ?? Date.now;
    this.onDiagnostic = options.onDiagnostic;
    this.onError = options.onError;
    this.onScan = options.onScan;
    this.onSessionChange = options.onSessionChange;
    this.onStateChange = options.onStateChange;
    this.reconnectDelayMs =
      options.reconnectDelayMs ??
      ((attempt) => Math.min(15_000, 1_500 * attempt));
    this.serial = options.serial;
    this.stableAfterMs = options.stableAfterMs ?? DEFAULT_STABLE_AFTER_MS;
  }

  get deviceLabel() {
    return getSerialDeviceLabel(this.currentRun?.port ?? this.selectedPort);
  }

  get state() {
    return this.snapshot;
  }

  start() {
    this.serial.addEventListener?.('disconnect', this.handleDisconnectEvent);
    return this.enqueue(async () => {
      if (this.disposed) return;
      let known: KnownPortResult;
      try {
        known = await this.findKnownPort();
      } catch (error) {
        const message = getErrorMessage(
          error,
          'Браузер не смог получить список Web Serial устройств.',
        );
        this.setReason(
          'terminal',
          'known_port_query_failed',
          'Не удалось проверить сканер',
          'Chrome не смог получить список разрешённых Web Serial устройств.',
        );
        this.emitDiagnostic({
          code: 'known_port_query_failed',
          eventType: 'client_reconnect_failed',
          message,
          metadata: { reason: 'initial' },
          severity: 'warning',
          status: 'terminal',
        });
        return;
      }
      if (!known.port) {
        this.setReason(
          'disconnected',
          known.code ?? 'known_port_unavailable',
          'Сканер не подключен',
          known.message ??
            'Ранее разрешённый сканер не найден. Подключите его вручную.',
        );
        return;
      }
      await this.openPort(known.port, 'initial', this.epoch);
    });
  }

  async connectManually() {
    const actionEpoch = this.beginManualAction();
    this.setReason(
      'connecting',
      'manual_connect_started',
      'Подключение сканера',
      'Выберите сканер в окне браузера.',
    );

    let port: SerialPortLike;
    try {
      port = await this.serial.requestPort();
    } catch (error) {
      if (actionEpoch !== this.epoch || this.disposed) return;
      const classified = classifyOpenError(error);
      this.setReason(
        'terminal',
        classified.code,
        classified.title,
        classified.message,
      );
      this.onError?.(classified.title, classified.message);
      this.emitDiagnostic({
        code: classified.code,
        eventType: 'client_reconnect_failed',
        message: classified.message,
        metadata: {
          browserMessage: classified.browserMessage,
          reason: 'manual',
        },
        severity: classified.code === 'port_not_selected' ? 'warning' : 'error',
        status: classified.code === 'port_not_selected' ? 'cancelled' : 'failed',
      });
      return;
    }

    this.selectedPort = port;
    this.selectedFingerprint = getSerialPortFingerprint(port);
    await this.enqueue(async () => {
      if (actionEpoch !== this.epoch || this.disposed) return;
      await this.cleanupCurrentRun();
      await this.openPort(port, 'manual', actionEpoch);
    });
  }

  async disconnectManually() {
    this.beginManualAction(false);
    this.intentionalDisconnect = true;
    await this.enqueue(async () => {
      const run = this.currentRun;
      const metadata = run ? this.buildRunMetadata(run) : {};
      if (run) run.failed = true;
      await this.cleanupCurrentRun();
      this.reconnectAttempts = 0;
      this.setReason(
        'disconnected',
        'manual_disconnect',
        'Сканер отключён',
        'Автопереподключение выключено до ручного подключения.',
      );
      this.emitDiagnostic({
        code: 'manual_disconnect',
        eventType: 'client_disconnected',
        message: 'Сканер отключён вручную',
        metadata: { ...metadata, reason: 'manual' },
        severity: 'info',
        status: 'manual',
      });
    });
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.epoch += 1;
    this.intentionalDisconnect = true;
    this.serial.removeEventListener?.(
      'disconnect',
      this.handleDisconnectEvent,
    );
    this.clearReconnectTimer();
    this.clearStableTimer();
    await this.enqueue(async () => {
      const run = this.currentRun;
      if (run) run.failed = true;
      await this.cleanupCurrentRun();
    });
  }

  private beginManualAction(createSession = true) {
    this.epoch += 1;
    this.intentionalDisconnect = false;
    this.reconnectAttempts = 0;
    this.clearReconnectTimer();
    this.clearStableTimer();
    if (createSession) {
      const sessionId = this.createSessionId();
      this.onSessionChange?.(sessionId);
    }
    return this.epoch;
  }

  private enqueue(task: () => Promise<void>) {
    const next = this.operation.then(task, task);
    this.operation = next.catch(() => undefined);
    return next;
  }

  private updateSnapshot(update: Partial<ScannerLifecycleSnapshot>) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...update };
    this.onStateChange(this.snapshot);
  }

  private setReason(
    status: ScannerLifecycleStatus,
    code: string,
    title: string,
    message: string,
  ) {
    this.updateSnapshot({
      lastReason: {
        at: new Date(this.now()).toISOString(),
        code,
        message,
        title,
      },
      reconnectAttempt: this.reconnectAttempts,
      status,
    });
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearStableTimer() {
    if (!this.stableTimer) return;
    clearTimeout(this.stableTimer);
    this.stableTimer = null;
  }

  private async cleanupCurrentRun() {
    const run = this.currentRun;
    if (!run) return;

    run.failed = true;
    this.currentRun = null;
    this.clearStableTimer();

    const reader = run.reader;
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // Chrome may already release the reader after a physical disconnect.
      }
      try {
        await reader.closed;
      } catch {
        // A failed stream rejects reader.closed; the lock can still be released.
      }
      try {
        reader.releaseLock();
      } catch {
        // The read loop or Chrome may have released the lock first.
      }
      if (run.reader === reader) run.reader = null;
    }

    try {
      await run.port.close();
    } catch {
      // A physically removed device may already have a closed port.
    }
  }

  private async openPort(
    port: SerialPortLike,
    reason: 'auto' | 'initial' | 'manual',
    expectedEpoch: number,
  ) {
    if (expectedEpoch !== this.epoch || this.disposed) return;
    this.clearReconnectTimer();
    this.setReason(
      reason === 'auto' ? 'reconnecting' : 'connecting',
      'port_opening',
      reason === 'auto' ? 'Переподключение сканера' : 'Подключение сканера',
      'Открывается Web Serial порт.',
    );

    try {
      await port.open({ baudRate: this.baudRate });
    } catch (error) {
      if (expectedEpoch !== this.epoch || this.disposed) return;
      const classified = classifyOpenError(error);
      try {
        await port.close();
      } catch {
        // A failed or partially completed open may already leave the port closed.
      }
      this.emitDiagnostic({
        code: classified.code,
        eventType: 'client_reconnect_failed',
        message: classified.message,
        metadata: {
          attempt: this.reconnectAttempts,
          browserMessage: classified.browserMessage,
          deviceLabel: getSerialDeviceLabel(port),
          portFingerprint: getSerialPortFingerprint(port),
          reason,
        },
        severity: 'warning',
        status: 'failed',
      });

      if (reason === 'auto') {
        this.scheduleReconnect(classified);
      } else {
        this.setReason(
          'terminal',
          classified.code,
          classified.title,
          classified.message,
        );
        this.onError?.(classified.title, classified.message);
      }
      return;
    }

    if (expectedEpoch !== this.epoch || this.disposed) {
      try {
        await port.close();
      } catch {
        // A stale open cannot become the active port.
      }
      return;
    }

    this.selectedPort = port;
    this.selectedFingerprint = getSerialPortFingerprint(port);
    const run: ScannerRun = {
      failed: false,
      healthy: false,
      id: ++this.runSequence,
      openedAt: this.now(),
      port,
      reader: null,
    };
    this.currentRun = run;
    this.intentionalDisconnect = false;

    // Opening a port is not proof of stability. The circuit-breaker resets only
    // after real data or a healthy reading window.
    this.setReason(
      'connected',
      'port_opened',
      'Сканер подключён',
      this.reconnectAttempts > 0
        ? `Порт открыт после попытки ${this.reconnectAttempts}; проверяем стабильность чтения.`
        : 'Порт открыт; проверяем стабильность чтения.',
    );
    this.emitDiagnostic({
      code: 'port_opened',
      eventType: 'client_connected',
      message: 'Web Serial порт открыт',
      metadata: this.buildRunMetadata(run, {
        attempt: this.reconnectAttempts,
        nextState: 'connected',
        previousState: reason === 'auto' ? 'reconnecting' : 'connecting',
        reason,
      }),
      severity: 'info',
      status: 'connected',
    });

    this.stableTimer = setTimeout(() => {
      this.markRunHealthy(run, 'stable_window');
    }, this.stableAfterMs);
    void this.readLoop(run);
  }

  private async readLoop(run: ScannerRun) {
    const readable = run.port.readable;
    if (!readable) {
      this.handleRunFailure(run, {
        code: 'readable_unavailable',
        eventType: 'client_reader_error',
        message: 'После открытия порт не предоставил readable stream.',
        title: 'Сканер не отдаёт данные',
        trigger: 'reader_error',
      });
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    const reader = readable.getReader();
    run.reader = reader;

    try {
      while (!run.failed && this.currentRun === run && !this.disposed) {
        const { value, done } = await reader.read();
        if (done) {
          this.handleRunFailure(run, {
            code: 'stream_ended',
            eventType: 'client_reader_error',
            message: 'Readable stream сканера завершился.',
            title: 'Поток данных сканера закрыт',
            trigger: 'stream_ended',
          });
          return;
        }

        if (!value?.byteLength) continue;
        this.markRunHealthy(run, 'data_read');
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.search(/[\r\n]/)) !== -1) {
          const qrCode = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (qrCode) {
            try {
              this.onScan(qrCode);
            } catch (error) {
              this.emitDiagnostic({
                code: 'scan_enqueue_failed',
                eventType: 'client_scan_submit_failed',
                message: getErrorMessage(
                  error,
                  'Не удалось добавить QR в очередь отправки.',
                ),
                metadata: this.buildRunMetadata(run, {
                  queueStage: 'enqueue',
                }),
                severity: 'error',
                status: 'failed',
              });
            }
          }
        }
      }
    } catch (error) {
      const browserMessage = getErrorMessage(
        error,
        'Сканер перестал отдавать данные.',
      );
      const isNetworkError =
        error instanceof DOMException && error.name === 'NetworkError';
      this.handleRunFailure(run, {
        browserMessage,
        code: isNetworkError
          ? 'device_communication_error'
          : 'reader_failed',
        errorName: error instanceof Error ? error.name : undefined,
        eventType: 'client_reader_error',
        message: isNetworkError
          ? 'Chrome потерял связь с USB-устройством.'
          : 'Поток чтения сканера завершился с ошибкой.',
        title: 'Сканер перестал отдавать данные',
        trigger: 'reader_error',
      });
    } finally {
      if (run.reader === reader) run.reader = null;
      try {
        reader.releaseLock();
      } catch {
        // Chrome can release the lock when the device disappears.
      }
    }
  }

  private markRunHealthy(
    run: ScannerRun,
    proof: 'data_read' | 'stable_window',
  ) {
    if (run.failed || run.healthy || this.currentRun !== run || this.disposed) {
      return;
    }
    run.healthy = true;
    this.clearStableTimer();
    this.reconnectAttempts = 0;
    this.setReason(
      'connected',
      proof,
      'Сканер работает стабильно',
      proof === 'data_read'
        ? 'Получены данные от сканера.'
        : 'Поток чтения стабилен 30 секунд.',
    );
    this.emitDiagnostic({
      code: proof,
      eventType: 'client_connection_stable',
      message:
        proof === 'data_read'
          ? 'Получены данные от Web Serial устройства'
          : 'Web Serial чтение стабильно в течение контрольного окна',
      metadata: this.buildRunMetadata(run, { proof }),
      severity: 'info',
      status: 'stable',
    });
  }

  private handleRunFailure(run: ScannerRun, details: FailureDetails) {
    if (
      run.failed ||
      this.currentRun !== run ||
      this.intentionalDisconnect ||
      this.disposed
    ) {
      return;
    }

    // Set synchronously so a disconnect event and reader rejection coalesce
    // into one lifecycle transition and one reconnect schedule.
    run.failed = true;
    const metadata = this.buildRunMetadata(run, {
      browserMessage: details.browserMessage,
      errorCode: details.code,
      errorName: details.errorName,
      nextState: 'reconnecting',
      previousState: 'connected',
      trigger: details.trigger,
    });
    void this.enqueue(async () => {
      if (this.currentRun !== run || this.intentionalDisconnect || this.disposed) {
        return;
      }
      this.emitDiagnostic({
        code: details.code,
        eventType: details.eventType,
        message: details.message,
        metadata,
        severity: 'error',
        status: 'failed',
      });
      await this.cleanupCurrentRun();
      this.onError?.(details.title, details.message);
      this.scheduleReconnect(details);
    });
  }

  private scheduleReconnect(reason: {
    code: string;
    message: string;
    title: string;
  }) {
    if (this.intentionalDisconnect || this.disposed || this.reconnectTimer) {
      return;
    }

    const attempt = this.reconnectAttempts + 1;
    const deviceMetadata = this.buildSelectedPortMetadata();
    if (attempt > this.maxReconnectAttempts) {
      this.setReason(
        'terminal',
        reason.code,
        'Автопереподключение остановлено',
        `${reason.title}. Проверьте USB-подключение и нажмите «Подключить снова».`,
      );
      this.emitDiagnostic({
        code: 'reconnect_limit_reached',
        eventType: 'client_reconnect_failed',
        message: reason.message,
        metadata: {
          ...deviceMetadata,
          attempt: this.reconnectAttempts,
          lastErrorCode: reason.code,
          nextState: 'terminal',
          previousState: 'reconnecting',
          terminal: true,
        },
        severity: 'error',
        status: 'terminal',
      });
      return;
    }

    this.reconnectAttempts = attempt;
    const delayMs = this.reconnectDelayMs(attempt);
    const scheduledEpoch = this.epoch;
    const previousState = this.snapshot.status;
    this.setReason(
      'reconnecting',
      reason.code,
      `Переподключение: попытка ${attempt} из ${this.maxReconnectAttempts}`,
      `${reason.message} Следующая попытка через ${(delayMs / 1000).toFixed(1)} сек.`,
    );
    this.emitDiagnostic({
      code: reason.code,
      eventType: 'client_reconnect_scheduled',
      message: reason.message,
      metadata: {
        ...deviceMetadata,
        attempt,
        delayMs,
        lastErrorCode: reason.code,
        nextState: 'reconnecting',
        previousState,
      },
      severity: 'warning',
      status: 'scheduled',
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.enqueue(async () => {
        if (
          scheduledEpoch !== this.epoch ||
          this.intentionalDisconnect ||
          this.disposed
        ) {
          return;
        }
        let known: KnownPortResult;
        try {
          known = await this.findKnownPort();
        } catch (error) {
          const message = getErrorMessage(
            error,
            'Chrome не смог получить список разрешённых Web Serial устройств.',
          );
          const nextReason = {
            code: 'known_port_query_failed',
            message:
              'Chrome не смог получить список разрешённых Web Serial устройств.',
            title: 'Не удалось проверить сканер',
          };
          this.emitDiagnostic({
            code: nextReason.code,
            eventType: 'client_reconnect_failed',
            message,
            metadata: { ...deviceMetadata, attempt },
            severity: 'warning',
            status: 'failed',
          });
          this.scheduleReconnect(nextReason);
          return;
        }
        if (!known.port) {
          const nextReason = {
            code: known.code ?? 'known_port_unavailable',
            message:
              known.message ?? 'Ранее разрешённый Web Serial порт не найден.',
            title:
              known.code === 'known_port_ambiguous'
                ? 'Нельзя однозначно выбрать сканер'
                : 'Сканер не найден',
          };
          this.emitDiagnostic({
            code: nextReason.code,
            eventType: 'client_reconnect_failed',
            message: nextReason.message,
            metadata: { ...deviceMetadata, attempt },
            severity: 'warning',
            status: 'failed',
          });
          if (nextReason.code === 'known_port_ambiguous') {
            this.setReason(
              'terminal',
              nextReason.code,
              nextReason.title,
              `${nextReason.message} Нажмите «Подключить снова» и выберите устройство.`,
            );
            return;
          }
          this.scheduleReconnect(nextReason);
          return;
        }
        await this.openPort(known.port, 'auto', scheduledEpoch);
      });
    }, delayMs);
  }

  private async findKnownPort(): Promise<KnownPortResult> {
    if (!this.serial.getPorts) {
      return {
        code: 'known_port_unavailable',
        message: 'Браузер не предоставил список разрешённых Web Serial портов.',
        port: null,
      };
    }

    const ports = await this.serial.getPorts();
    if (this.selectedPort && ports.includes(this.selectedPort)) {
      return { port: this.selectedPort };
    }

    if (this.selectedFingerprint) {
      const matches = ports.filter(
        (port) =>
          getSerialPortFingerprint(port) === this.selectedFingerprint,
      );
      if (matches.length === 1) return { port: matches[0] };
      if (matches.length > 1) {
        return {
          code: 'known_port_ambiguous',
          message:
            'Найдено несколько одинаковых USB-устройств с тем же vendor/product ID.',
          port: null,
        };
      }
    }

    if (ports.length === 1) return { port: ports[0] };
    if (ports.length > 1) {
      return {
        code: 'known_port_ambiguous',
        message:
          'Браузер видит несколько разрешённых Web Serial устройств, но активный сканер не определён.',
        port: null,
      };
    }

    return {
      code: 'known_port_unavailable',
      message: 'Ранее разрешённый Web Serial порт не найден.',
      port: null,
    };
  }

  private buildRunMetadata(
    run: ScannerRun,
    extra: Record<string, unknown> = {},
  ) {
    return {
      deviceLabel: getSerialDeviceLabel(run.port),
      hadSuccessfulRead: run.healthy,
      lifetimeMs: Math.max(0, this.now() - run.openedAt),
      portFingerprint: getSerialPortFingerprint(run.port),
      readable: Boolean(run.port.readable),
      reconnectAttempt: this.reconnectAttempts,
      runId: run.id,
      ...extra,
    };
  }

  private buildSelectedPortMetadata() {
    return {
      deviceLabel: getSerialDeviceLabel(this.selectedPort),
      portFingerprint:
        this.selectedFingerprint ?? getSerialPortFingerprint(this.selectedPort),
    };
  }

  private emitDiagnostic(event: ScannerDiagnosticEvent) {
    try {
      void this.onDiagnostic?.(event)?.catch(() => undefined);
    } catch {
      // Diagnostic delivery must never change the physical scanner lifecycle.
    }
  }

  private readonly handleDisconnectEvent = (event: Event) => {
    const run = this.currentRun;
    if (!run || this.intentionalDisconnect || this.disposed) return;

    const eventPort =
      (event as Event & { port?: SerialPortLike }).port ??
      (event.target as SerialPortLike | null);
    if (eventPort !== run.port) return;

    this.handleRunFailure(run, {
      code: 'hardware_disconnect',
      eventType: 'client_disconnected',
      message: 'Chrome сообщил об отключении Web Serial устройства.',
      title: 'Сканер отключён от компьютера',
      trigger: 'hardware_disconnect',
    });
  };
}
