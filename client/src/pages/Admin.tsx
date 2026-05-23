import { useState, useCallback, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import {
  UserPlus,
  Search,
  Trash2,
  CheckCircle2,
  XCircle,
  LogIn,
  RefreshCcw,
  Usb,
  Unplug,
  Check,
  AlertTriangle,
  Clock3,
  History,
  Loader2,
  RotateCw,
  WifiOff,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { API_URL } from '@/config';
import { apiFetch, getAuthToken } from '@/lib/api';
import type { ReferenceItem } from '@/lib/references';
import { fetchReferences } from '@/lib/references';
import { HelpTooltip } from '@/components/dashboard-metric';

const socket = io(API_URL, {
  autoConnect: false,
  auth: {
    token: getAuthToken(),
  },
});

const EMPTY_RECEPTION_CLIENT_FORM = {
  name: '',
  phone: '',
  sourceId: '',
  source: 'Ресепшн (Админ)',
  note: '',
};

type ScannerStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

type AudioContextConstructor = typeof AudioContext;

interface VisitCard {
  id: string;
  success: boolean;
  time: string;
  clientEventId?: string | null;
  name?: string;
  phone?: string;
  source?: string;
  telegramId?: string;
  vkId?: string;
  webId?: string;
  visitId?: number;
  qrRaw?: string;
  keyNumber: string;
  keyIssued: boolean;
  isRepeated?: boolean;
  category?: string;
  categoryIds?: number[];
}

interface ScanResultPayload {
  id?: string;
  success?: boolean;
  time?: string;
  clientEventId?: string | null;
  isRepeated?: boolean;
  user?: {
    id?: number;
    name?: string;
    phone?: string;
    source?: string;
    telegramId?: string;
    vkId?: string;
    webId?: string;
  };
  visitId?: number;
  keyNumber?: string;
  keyIssued?: boolean;
  category?: string;
  categoryIds?: number[];
}

interface ScannerEvent {
  id: number;
  eventType: string;
  severity: 'info' | 'warning' | 'error';
  status?: string | null;
  message?: string | null;
  code?: string | null;
  source?: string | null;
  qrPreview?: string | null;
  qrHash?: string | null;
  visitId?: number | null;
  userId?: number | null;
  clientEventId?: string | null;
  createdAt: string;
  account?: {
    id: number;
    name?: string;
    email?: string;
    role?: string;
  } | null;
  user?: {
    id: number;
    name: string;
  } | null;
}

interface PendingScan {
  attempts: number;
  clientEventId: string;
  createdAt: number;
  qrCode: string;
}

interface SearchUser {
  id: number;
  name: string;
  phone: string;
}

interface ExistingClientCandidate {
  id: number;
  name: string;
  note?: string | null;
  phone: string;
  source?: string;
  sourceId?: number | null;
  status?: 'active' | 'archived';
  stats?: {
    visitCount: number;
    lastVisitAt?: string | null;
  };
}

interface SerialPortLike {
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  getInfo?: () => {
    usbVendorId?: number;
    usbProductId?: number;
  };
}

interface NavigatorWithSerial extends Navigator {
  serial?: {
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
  };
}

function getPhoneDigits(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function formatClientPhone(value: string) {
  let digits = value.replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith('8')) {
    digits = `7${digits.slice(1)}`;
  }

  if (!digits.startsWith('7')) {
    digits = `7${digits}`;
  }

  const local = digits.slice(1, 11);
  let formatted = '+7';

  if (local.length > 0) {
    formatted += ` (${local.slice(0, 3)}`;
  }
  if (local.length >= 3) {
    formatted += ')';
  }
  if (local.length > 3) {
    formatted += ` ${local.slice(3, 6)}`;
  }
  if (local.length > 6) {
    formatted += `-${local.slice(6, 8)}`;
  }
  if (local.length > 8) {
    formatted += `-${local.slice(8, 10)}`;
  }

  return formatted;
}

async function readApiError(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as {
      client?: ExistingClientCandidate;
      code?: string;
      error?: string;
    };
    return {
      client: data.client,
      code: data.code,
      error: data.error || fallback,
    };
  } catch {
    return { error: fallback };
  }
}

function splitVisitCategories(category?: string) {
  return category ? category.split(', ').filter(Boolean) : [];
}

function getVisitCategoryNames(card: VisitCard) {
  return splitVisitCategories(card.category);
}

function getCategoryNamesByIds(categories: ReferenceItem[], categoryIds: number[]) {
  const names = categoryIds
    .map((id) => categories.find((category) => category.id === id)?.name)
    .filter(Boolean);
  return names.join(', ');
}

function createClientEventId(prefix = 'scanner') {
  const randomPart =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${randomPart}`;
}

function getDeviceLabel(port: SerialPortLike | null) {
  const info = port?.getInfo?.();
  if (!info?.usbVendorId && !info?.usbProductId) return 'Web Serial';
  return `USB ${info.usbVendorId || '-'}:${info.usbProductId || '-'}`;
}

function getPortFingerprint(port: SerialPortLike | null) {
  const info = port?.getInfo?.();
  if (!info?.usbVendorId && !info?.usbProductId) return 'web-serial';
  return `${info.usbVendorId || 'unknown'}:${info.usbProductId || 'unknown'}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getScannerEventLabel(eventType: string) {
  const labels: Record<string, string> = {
    client_connected: 'Подключен',
    client_disconnected: 'Отключен',
    client_reconnect_scheduled: 'Автопереподключение',
    client_reconnect_failed: 'Не удалось переподключить',
    client_reader_error: 'Ошибка чтения',
    client_scan_submit_failed: 'Ошибка отправки QR',
    key_issued: 'Ключ',
    manual_duplicate: 'Повтор ручного входа',
    manual_success: 'Ручной вход',
    qr_duplicate: 'Повтор QR',
    qr_error: 'Ошибка QR',
    qr_not_found: 'QR не найден',
    qr_success: 'QR найден',
    visit_category_changed: 'Цель визита',
  };

  return labels[eventType] || eventType;
}

function getScannerStatusText(status: ScannerStatus) {
  if (status === 'connected') return 'Сканер активен';
  if (status === 'connecting') return 'Подключение...';
  if (status === 'reconnecting') return 'Переподключение...';
  return 'Сканер отключен';
}

function playSound(type: 'success' | 'error') {
  const AudioContextClass: AudioContextConstructor | undefined =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: AudioContextConstructor })
      .webkitAudioContext;
  if (!AudioContextClass) return;

  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = type === 'success' ? 880 : 220;
  gain.gain.value = 0.08;
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + (type === 'success' ? 0.08 : 0.16));
  oscillator.onended = () => {
    void context.close();
  };
}

export default function AdminPage() {
  const [cards, setCards] = useState<VisitCard[]>([]);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isRegOpen, setIsRegOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDisconnectOpen, setIsDisconnectOpen] = useState(false);
  const [cardToDelete, setCardToDelete] = useState<string | null>(null);
  const [activeVisit, setActiveVisit] = useState<VisitCard | null>(null);
  const [visitActionError, setVisitActionError] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [searchError, setSearchError] = useState('');
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scannerStatus, setScannerStatus] = useState<
    ScannerStatus
  >('disconnected');
  const [scannerLastError, setScannerLastError] = useState('');
  const [scannerLastEvent, setScannerLastEvent] = useState('');
  const [scannerSessionId, setScannerSessionId] = useState(() =>
    createClientEventId('session'),
  );
  const [scannerEvents, setScannerEvents] = useState<ScannerEvent[]>([]);
  const [isScannerJournalOpen, setIsScannerJournalOpen] = useState(false);
  const [queuedVisits, setQueuedVisits] = useState<VisitCard[]>([]);
  const activeVisitRef = useRef<VisitCard | null>(null);
  const processedClientEventsRef = useRef<Set<string>>(new Set());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const intentionalDisconnectRef = useRef(false);
  const scannerSessionIdRef = useRef(scannerSessionId);
  const scannerRunIdRef = useRef(0);
  const selectedPortFingerprintRef = useRef<string | null>(null);
  const portRef = useRef<SerialPortLike | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(
    null,
  );
  const scannerActiveRef = useRef(false);
  const scanQueueRef = useRef<PendingScan[]>([]);
  const scanQueueProcessingRef = useRef(false);

  const [regForm, setRegForm] = useState(EMPTY_RECEPTION_CLIENT_FORM);
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState('');
  const [regCandidate, setRegCandidate] =
    useState<ExistingClientCandidate | null>(null);
  const [restoreCandidate, setRestoreCandidate] =
    useState<ExistingClientCandidate | null>(null);
  const [clientSources, setClientSources] = useState<ReferenceItem[]>([]);
  const [visitCategories, setVisitCategories] = useState<ReferenceItem[]>([]);
  const [pendingScanCount, setPendingScanCount] = useState(0);
  const [issuingKeyVisitId, setIssuingKeyVisitId] = useState<number | null>(
    null,
  );
  const [savingCategoryVisitId, setSavingCategoryVisitId] = useState<
    number | null
  >(null);

  useEffect(() => {
    activeVisitRef.current = activeVisit;
  }, [activeVisit]);

  useEffect(() => {
    scannerSessionIdRef.current = scannerSessionId;
  }, [scannerSessionId]);

  const getEmptyReceptionForm = useCallback(() => {
    const defaultSource =
      clientSources.find((source) => source.name === 'Ресепшн (Админ)') ||
      clientSources[0];

    return {
      ...EMPTY_RECEPTION_CLIENT_FORM,
      sourceId: defaultSource ? String(defaultSource.id) : '',
      source: defaultSource?.name || EMPTY_RECEPTION_CLIENT_FORM.source,
    };
  }, [clientSources]);

  const fetchHistory = async () => {
    try {
      const res = await apiFetch('/api/visits');
      if (res.ok) {
        const history = await res.json();
        setCards(history);
      }
    } catch (e) {
      console.error('Ошибка загрузки истории:', e);
    }
  };

  const fetchScannerEvents = useCallback(async () => {
    try {
      const res = await apiFetch('/api/scanner-events?limit=30');
      if (res.ok) {
        setScannerEvents((await res.json()) as ScannerEvent[]);
      }
    } catch (e) {
      console.error('Ошибка загрузки журнала сканера:', e);
    }
  }, []);

  const recordScannerClientEvent = useCallback(
    async (
      eventType: string,
      options: {
        severity?: 'info' | 'warning' | 'error';
        status?: string;
        message?: string;
        code?: string;
        clientEventId?: string;
        metadata?: Record<string, unknown>;
      } = {},
    ) => {
      try {
        await apiFetch('/api/scanner-events', {
          method: 'POST',
          body: JSON.stringify({
            eventType,
            severity: options.severity || 'info',
            status: options.status,
            message: options.message,
            code: options.code,
            source: 'web_serial',
            clientEventId: options.clientEventId || createClientEventId('client'),
            metadata: {
              scannerSessionId: scannerSessionIdRef.current,
              deviceLabel: getDeviceLabel(portRef.current),
              ...options.metadata,
            },
          }),
        });
        void fetchScannerEvents();
      } catch (e) {
        console.error('Ошибка записи события сканера:', e);
      }
    },
    [fetchScannerEvents],
  );

  useEffect(() => {
    fetchHistory();
    void fetchScannerEvents();
  }, [fetchScannerEvents]);

  useEffect(() => {
    let cancelled = false;

    async function loadReferences() {
      try {
        const [sources, categories] = await Promise.all([
          fetchReferences('client-sources'),
          fetchReferences('visit-categories'),
        ]);
        if (cancelled) return;

        setClientSources(sources);
        setVisitCategories(categories);
        const defaultSource =
          sources.find((source) => source.name === 'Ресепшн (Админ)') ||
          sources[0];
        if (defaultSource) {
          setRegForm((prev) =>
            prev.sourceId
              ? prev
              : {
                  ...prev,
                  sourceId: String(defaultSource.id),
                  source: defaultSource.name,
                },
          );
        }
      } catch (error) {
        console.error('Ошибка загрузки справочников:', error);
      }
    }

    void loadReferences();
    return () => {
      cancelled = true;
    };
  }, []);

  const buildVisitCard = useCallback((data: ScanResultPayload): VisitCard => {
    const time = new Date().toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });

    return {
      id: data.visitId
        ? `visit-${data.visitId}`
        : data.clientEventId || `scan-${Date.now()}`,
      success: Boolean(data.success),
      time,
      clientEventId: data.clientEventId || null,
      isRepeated: data.isRepeated,
      name: data.user?.name || '',
      phone: data.user?.phone || '',
      source: data.user?.source || '-',
      telegramId: data.user?.telegramId,
      vkId: data.user?.vkId,
      webId: data.user?.webId,
      visitId: data.visitId,
      qrRaw: data.id,
      keyNumber: data.keyNumber || '',
      keyIssued: Boolean(data.keyIssued),
      category: data.category || '',
      categoryIds: data.categoryIds || [],
    };
  }, []);

  const isSameVisitCard = useCallback((a: VisitCard, b: VisitCard) => {
    if (a.visitId && b.visitId) return a.visitId === b.visitId;
    if (a.clientEventId && b.clientEventId) {
      return a.clientEventId === b.clientEventId;
    }
    if (!a.success && !b.success && a.qrRaw && b.qrRaw) {
      return a.qrRaw === b.qrRaw;
    }
    return a.id === b.id;
  }, []);

  const setCurrentVisit = useCallback((visit: VisitCard | null) => {
    activeVisitRef.current = visit;
    setActiveVisit(visit);
  }, []);

  const handleIncomingVisit = useCallback(
    (data: ScanResultPayload) => {
      const newCard = buildVisitCard(data);

      if (
        newCard.clientEventId &&
        processedClientEventsRef.current.has(newCard.clientEventId)
      ) {
        return;
      }
      if (newCard.clientEventId) {
        processedClientEventsRef.current.add(newCard.clientEventId);
      }

      playSound(newCard.success ? 'success' : 'error');

      setCards((prev) => {
        const filtered = prev.filter((card) => !isSameVisitCard(card, newCard));
        return [newCard, ...filtered].slice(0, 50);
      });

      const currentActiveVisit = activeVisitRef.current;
      if (currentActiveVisit && !isSameVisitCard(currentActiveVisit, newCard)) {
        setQueuedVisits((prev) => {
          if (prev.some((card) => isSameVisitCard(card, newCard))) return prev;
          return [...prev, newCard];
        });
        return;
      }

      setVisitActionError('');
      setCurrentVisit(newCard);
    },
    [buildVisitCard, isSameVisitCard, setCurrentVisit],
  );

  const closeActiveVisit = useCallback(() => {
    setVisitActionError('');
    const [nextVisit, ...rest] = queuedVisits;
    setQueuedVisits(rest);
    setCurrentVisit(nextVisit || null);
  }, [queuedVisits, setCurrentVisit]);

  useEffect(() => {
    socket.auth = { token: getAuthToken() };
    socket.connect();
    socket.on('scan_result', handleIncomingVisit);

    return () => {
      socket.off('scan_result', handleIncomingVisit);
      socket.disconnect();
    };
  }, [handleIncomingVisit]);

  const syncPendingScanCount = useCallback(() => {
    setPendingScanCount(scanQueueRef.current.length);
  }, []);

  function clearScanRetryTimer() {
    if (scanRetryTimerRef.current) {
      window.clearTimeout(scanRetryTimerRef.current);
      scanRetryTimerRef.current = null;
    }
  }

  const processScanQueue = useCallback(async () => {
    if (scanQueueProcessingRef.current) return;
    scanQueueProcessingRef.current = true;
    clearScanRetryTimer();

    try {
      while (scanQueueRef.current.length > 0) {
        const scan = scanQueueRef.current[0];

        try {
          setScannerLastEvent(
            scan.attempts > 0
              ? `Повторная отправка QR, попытка ${scan.attempts + 1}`
              : 'QR отправлен в CRM',
          );

          const res = await apiFetch('/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              qr: scan.qrCode,
              clientEventId: scan.clientEventId,
              scannerSessionId: scannerSessionIdRef.current,
              deviceLabel: getDeviceLabel(portRef.current),
            }),
          });
          if (!res.ok) {
            const apiError = await readApiError(res, 'Ошибка сканирования QR');
            throw new Error(apiError.error);
          }

          const data = await res.json();
          scanQueueRef.current.shift();
          syncPendingScanCount();
          setScannerLastError('');
          setScannerLastEvent('QR обработан');

          if (data.event) {
            handleIncomingVisit(data.event);
            void fetchScannerEvents();
          }
        } catch (e) {
          console.error('Ошибка сканера:', e);
          const message =
            e instanceof Error ? e.message : 'Не удалось отправить QR в CRM';
          scan.attempts += 1;
          const delay = Math.min(
            30000,
            1000 * 2 ** Math.min(scan.attempts, 5),
          );

          setScannerLastError(
            `${message}. QR сохранен в очереди и будет отправлен повторно.`,
          );
          setScannerLastEvent(
            `Повторная отправка через ${(delay / 1000).toFixed(0)} сек.`,
          );
          void recordScannerClientEvent('client_scan_submit_failed', {
            severity: 'error',
            status: 'retry_scheduled',
            message,
            clientEventId: createClientEventId('scan-failed'),
            metadata: {
              attempts: scan.attempts,
              nextRetryDelayMs: delay,
              originalClientEventId: scan.clientEventId,
            },
          });

          scanRetryTimerRef.current = window.setTimeout(() => {
            void processScanQueue();
          }, delay);
          break;
        }
      }
    } finally {
      scanQueueProcessingRef.current = false;
    }
  }, [
    fetchScannerEvents,
    handleIncomingVisit,
    recordScannerClientEvent,
    syncPendingScanCount,
  ]);

  const enqueueScan = useCallback(
    (qrCode: string) => {
      const normalizedQr = qrCode.trim();
      if (!normalizedQr) return;

      scanQueueRef.current.push({
        attempts: 0,
        clientEventId: createClientEventId('scan'),
        createdAt: Date.now(),
        qrCode: normalizedQr,
      });
      syncPendingScanCount();
      setScannerLastEvent('QR добавлен в очередь обработки');
      void processScanQueue();
    },
    [processScanQueue, syncPendingScanCount],
  );

  function clearReconnectTimer() {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }

  async function waitForReaderRelease(
    reader: ReadableStreamDefaultReader<Uint8Array> | null,
  ) {
    if (!reader) return;

    for (let i = 0; i < 10; i += 1) {
      if (readerRef.current !== reader) return;
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
  }

  async function closeScannerPort(
    nextStatus: 'disconnected' | 'reconnecting' = 'disconnected',
    options: { markStale?: boolean } = {},
  ) {
    if (options.markStale !== false) {
      scannerRunIdRef.current += 1;
    }
    scannerActiveRef.current = false;

    const reader = readerRef.current;
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // reader may already be released after a hardware disconnect
      }
      await waitForReaderRelease(reader);
    }

    const port = portRef.current;
    if (port) {
      try {
        await port.close();
      } catch {
        // Chrome may already close the port on physical disconnect
      }
      if (portRef.current === port) {
        portRef.current = null;
      }
    }

    setScannerStatus(nextStatus);
  }

  async function readScannerLoop(port: SerialPortLike, runId: number) {
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (scannerActiveRef.current && port.readable) {
        const readable = port.readable;
        if (!readable) break;

        const reader = readable.getReader();
        readerRef.current = reader;

        try {
          while (scannerActiveRef.current) {
            const { value, done } = await reader.read();
            if (done) break;

            if (value) {
              buffer += decoder.decode(value, { stream: true });

              let newlineIndex;
              while ((newlineIndex = buffer.search(/[\r\n]/)) !== -1) {
                const qrCode = buffer.slice(0, newlineIndex).trim();
                buffer = buffer.slice(newlineIndex + 1);

                if (qrCode) {
                  enqueueScan(qrCode);
                }
              }
            }
          }
        } finally {
          if (readerRef.current === reader) {
            readerRef.current = null;
          }
          try {
            reader.releaseLock();
          } catch {
            // reader can be unlocked by Chrome when the device disappears
          }
        }
      }
    } catch (error) {
      console.error('Сканер отключился или перестал отдавать данные:', error);
      const message =
        error instanceof Error
          ? error.message
          : 'Сканер перестал отдавать данные';
      setScannerLastError(message);
      await recordScannerClientEvent('client_reader_error', {
        severity: 'error',
        status: 'failed',
        message,
      });
    } finally {
      if (scannerRunIdRef.current === runId && portRef.current === port) {
        await closeScannerPort('reconnecting', { markStale: false });
        scheduleReconnect('Потеряно чтение данных со сканера');
      } else if (scannerRunIdRef.current === runId) {
        scannerActiveRef.current = false;
        setScannerStatus('disconnected');
      }
    }
  }

  async function openScannerPort(port: SerialPortLike, reason: string) {
    clearReconnectTimer();
    setScannerStatus(reason === 'manual' ? 'connecting' : 'reconnecting');
    setScannerLastError('');

    await port.open({ baudRate: 9600 });
    selectedPortFingerprintRef.current = getPortFingerprint(port);
    portRef.current = port;
    scannerActiveRef.current = true;
    const runId = scannerRunIdRef.current + 1;
    scannerRunIdRef.current = runId;
    intentionalDisconnectRef.current = false;
    reconnectAttemptRef.current = 0;
    setScannerStatus('connected');
    setScannerLastEvent('Сканер подключен');
    await recordScannerClientEvent('client_connected', {
      status: 'connected',
      message: 'Web Serial порт открыт',
      metadata: {
        reason,
        deviceLabel: getDeviceLabel(port),
        portFingerprint: getPortFingerprint(port),
      },
    });
    void readScannerLoop(port, runId);
  }

  async function tryReconnectToKnownPort(reason: string) {
    const serial = (navigator as NavigatorWithSerial).serial;
    if (!serial?.getPorts) return false;

    const ports = await serial.getPorts();
    const expectedFingerprint = selectedPortFingerprintRef.current;
    const port =
      expectedFingerprint
        ? ports.find((item) => getPortFingerprint(item) === expectedFingerprint)
        : ports.length === 1
          ? ports[0]
          : null;
    if (!port) return false;

    await openScannerPort(port, reason);
    return true;
  }

  function scheduleReconnect(reason: string) {
    if (intentionalDisconnectRef.current || scannerActiveRef.current) return;

    const attempt = reconnectAttemptRef.current + 1;
    reconnectAttemptRef.current = attempt;
    const delay = Math.min(15000, 1500 * attempt);

    setScannerStatus('reconnecting');
    setScannerLastEvent(
      `Автопереподключение через ${(delay / 1000).toFixed(1)} сек.`,
    );
    void recordScannerClientEvent('client_reconnect_scheduled', {
      severity: 'warning',
      status: 'scheduled',
      message: reason,
      metadata: {
        attempt,
        delayMs: delay,
      },
    });

    clearReconnectTimer();
    reconnectTimerRef.current = window.setTimeout(async () => {
      try {
        const connected = await tryReconnectToKnownPort('auto');
        if (!connected) {
          throw new Error('Нет ранее разрешенного Web Serial порта');
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Не удалось автоматически переподключить сканер';
        setScannerLastError(message);
        await recordScannerClientEvent('client_reconnect_failed', {
          severity: 'warning',
          status: 'failed',
          message,
          metadata: { attempt },
        });
        if (attempt < 8) {
          scheduleReconnect(reason);
        } else {
          setScannerStatus('disconnected');
          setScannerLastEvent('Автопереподключение остановлено');
        }
      }
    }, delay);
  }

  // --- ЛОГИКА СКАНЕРА ---
  const connectScanner = async () => {
    if (
      scannerStatus === 'connecting' ||
      scannerStatus === 'connected' ||
      scannerActiveRef.current
    ) {
      return;
    }

    const serial = (navigator as NavigatorWithSerial).serial;

    if (!serial) {
      const message =
        'Ваш браузер не поддерживает Web Serial API. Используйте Google Chrome или Edge.';
      setScannerLastError(message);
      await recordScannerClientEvent('client_reconnect_failed', {
        severity: 'error',
        status: 'unsupported',
        message,
      });
      return;
    }

    let port: SerialPortLike | null = null;

    try {
      clearReconnectTimer();
      intentionalDisconnectRef.current = false;
      reconnectAttemptRef.current = 0;
      const nextSessionId = createClientEventId('session');
      scannerSessionIdRef.current = nextSessionId;
      setScannerSessionId(nextSessionId);
      setScannerStatus('connecting');
      port = await serial.requestPort();
      selectedPortFingerprintRef.current = getPortFingerprint(port);
      await openScannerPort(port, 'manual');
    } catch (error) {
      console.error('Ошибка порта:', error);
      const message =
        error instanceof Error ? error.message : 'Не удалось открыть сканер';
      if (port) {
        try {
          await port.close();
        } catch {
          // ignore cleanup errors after a failed open attempt
        }
      }
      scannerActiveRef.current = false;
      portRef.current = null;
      setScannerStatus('disconnected');
      setScannerLastError(message);
      await recordScannerClientEvent('client_reconnect_failed', {
        severity: 'error',
        status: 'failed',
        message,
      });
    }
  };

  const reconnectScanner = async () => {
    if (scannerStatus === 'connected' || scannerStatus === 'connecting') return;
    clearReconnectTimer();
    reconnectAttemptRef.current = 0;
    try {
      const connected = await tryReconnectToKnownPort('manual-reconnect');
      if (!connected) {
        await connectScanner();
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Не удалось переподключить';
      setScannerLastError(message);
      setScannerStatus('disconnected');
    }
  };

  const disconnectScanner = async () => {
    intentionalDisconnectRef.current = true;
    clearReconnectTimer();
    await recordScannerClientEvent('client_disconnected', {
      status: 'manual',
      message: 'Сканер отключен вручную',
    });
    await closeScannerPort('disconnected');
    setScannerLastEvent('Сканер отключен вручную');
    setIsDisconnectOpen(false);
  };

  useEffect(() => {
    const serial = (navigator as NavigatorWithSerial).serial;
    if (!serial) return;

    const handleDisconnect = (event: Event) => {
      const disconnectedPort = event.target as unknown as SerialPortLike | null;
      if (!portRef.current || disconnectedPort === portRef.current) {
        setScannerLastError('Устройство отключено от компьютера');
        void recordScannerClientEvent('client_disconnected', {
          severity: 'warning',
          status: 'hardware_disconnect',
          message: 'Chrome сообщил об отключении Web Serial устройства',
        });
        void closeScannerPort('reconnecting').then(() =>
          scheduleReconnect('Устройство отключено от компьютера'),
        );
      }
    };

    serial.addEventListener?.('disconnect', handleDisconnect);
    void tryReconnectToKnownPort('initial').catch(() => {
      // Пользователь подключит сканер вручную, если у браузера еще нет разрешенного порта.
    });

    return () => {
      serial.removeEventListener?.('disconnect', handleDisconnect);
      intentionalDisconnectRef.current = true;
      clearReconnectTimer();
      clearScanRetryTimer();
      void closeScannerPort('disconnected');
    };
    // Web Serial disconnect listener is bound once; mutable refs keep the current port/session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current);
      searchTimeout.current = null;
    }

    if (searchQuery.length < 2) {
      setSearchResults([]);
      setSearchError('');
      return;
    }

    let cancelled = false;
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await apiFetch(
          `/api/search?q=${encodeURIComponent(searchQuery)}`,
        );
        if (!res.ok) {
          const apiError = await readApiError(res, 'Поиск временно недоступен');
          throw new Error(apiError.error);
        }
        const data = await res.json();
        if (cancelled) return;
        setSearchResults(data);
        setSearchError('');
      } catch (e) {
        if (cancelled) return;
        console.error('Ошибка поиска', e);
        setSearchResults([]);
        setSearchError(
          e instanceof Error
            ? e.message
            : 'Поиск временно недоступен. Не создавайте дубль без проверки.',
        );
      }
    }, 300);

    return () => {
      cancelled = true;
      if (searchTimeout.current) {
        clearTimeout(searchTimeout.current);
        searchTimeout.current = null;
      }
    };
  }, [searchQuery]);

  useEffect(() => {
    const phoneDigits = getPhoneDigits(regForm.phone);
    if (!isRegOpen || phoneDigits.length !== 10) {
      setRegCandidate(null);
      return;
    }

    let cancelled = false;
    const checkedPhoneDigits = phoneDigits;

    const timeout = window.setTimeout(async () => {
      try {
        const res = await apiFetch(
          `/api/clients/lookup?phone=${encodeURIComponent(regForm.phone)}&includeArchived=true${
            restoreCandidate ? `&excludeClientId=${restoreCandidate.id}` : ''
          }`,
        );
        if (cancelled || getPhoneDigits(regForm.phone) !== checkedPhoneDigits) {
          return;
        }
        if (!res.ok) return;

        const data = (await res.json()) as {
          client: ExistingClientCandidate | null;
        };
        if (cancelled || getPhoneDigits(regForm.phone) !== checkedPhoneDigits) {
          return;
        }
        setRegCandidate(data.client);
      } catch (e) {
        console.error('Ошибка проверки дубля клиента:', e);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [isRegOpen, regForm.phone, restoreCandidate]);

  const handleManualVisit = async (userId: number) => {
    const clientEventId = createClientEventId('manual');
    try {
      const res = await apiFetch('/api/manual-visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          clientEventId,
          source: 'manual_search',
          metadata: { scannerSessionId: scannerSessionIdRef.current },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.event) handleIncomingVisit(data.event);
        setIsSearchOpen(false);
        setSearchQuery('');
        void fetchScannerEvents();
      } else {
        const apiError = await readApiError(res, 'Ошибка ручного добавления');
        throw new Error(apiError.error);
      }
    } catch (e) {
      console.error('Ошибка ручного добавления', e);
      setSearchError(
        e instanceof Error ? e.message : 'Не удалось создать ручной вход',
      );
    }
  };

  const handleUseExistingClient = async () => {
    if (!regCandidate) return;
    await handleManualVisit(regCandidate.id);
    setIsRegOpen(false);
    setRegForm(getEmptyReceptionForm());
    setRegCandidate(null);
    setRestoreCandidate(null);
  };

  const openReceptionRestore = (candidate: ExistingClientCandidate) => {
    setRestoreCandidate(candidate);
    setRegCandidate(null);
    setRegError('');
    setRegForm({
      name: candidate.name,
      note: candidate.note || '',
      phone: candidate.phone,
      source: candidate.source || getEmptyReceptionForm().source,
      sourceId: candidate.sourceId
        ? String(candidate.sourceId)
        : String(
            clientSources.find((source) => source.name === candidate.source)
              ?.id || '',
          ),
    });
  };

  const handlePhoneInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRegForm({ ...regForm, phone: formatClientPhone(e.target.value) });
  };

  const handleNameInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[\d]/g, '');
    setRegForm({ ...regForm, name: val });
  };

  const handleKeyInput = (cardId: string, val: string) => {
    const numericVal = val.replace(/\D/g, '');
    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, keyNumber: numericVal } : c)),
    );
    setActiveVisit((prev) =>
      prev?.id === cardId ? { ...prev, keyNumber: numericVal } : prev,
    );
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (regForm.name.trim().length < 2) {
      setRegError('Введите корректное имя');
      return;
    }
    if (getPhoneDigits(regForm.phone).length < 10) {
      setRegError('Слишком короткий номер телефона');
      return;
    }

    setRegLoading(true);
    setRegError('');

    try {
      const payload = {
        ...regForm,
        sourceId: regForm.sourceId ? Number(regForm.sourceId) : undefined,
      };
      const regRes = await apiFetch(
        restoreCandidate ? `/api/clients/${restoreCandidate.id}` : '/api/clients',
        {
          method: restoreCandidate ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            restoreCandidate ? { ...payload, status: 'active' } : payload,
          ),
        },
      );

      if (!regRes.ok) {
        const apiError = await readApiError(regRes, 'Ошибка регистрации');
        if (
          apiError.code === 'CLIENT_ARCHIVED_CONFLICT' &&
          apiError.client &&
          !restoreCandidate
        ) {
          openReceptionRestore(apiError.client);
          return;
        }

        setRegError(apiError.error);
        return;
      }

      const regData = (await regRes.json()) as {
        client?: { id: number };
      };
      if (!regData.client?.id) {
        setRegError('Клиент сохранен, но не удалось открыть визит');
        return;
      }

      const visitRes = await apiFetch('/api/manual-visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: regData.client.id,
          clientEventId: createClientEventId('manual'),
          source: 'reception_registration',
          metadata: { scannerSessionId: scannerSessionIdRef.current },
        }),
      });
      if (visitRes.ok) {
        const visitData = await visitRes.json();
        if (visitData.event) handleIncomingVisit(visitData.event);
      } else {
        const apiError = await readApiError(
          visitRes,
          'Клиент сохранен, но визит создать не удалось',
        );
        setRegError(apiError.error);
        return;
      }
      setIsRegOpen(false);
      setRegForm(getEmptyReceptionForm());
      setRegCandidate(null);
      setRestoreCandidate(null);
    } catch {
      setRegError('Ошибка сервера');
    } finally {
      setRegLoading(false);
    }
  };

  const handleIssueKey = async (
    visitId: number | undefined,
    keyNumber: string,
    cardId: string,
  ) => {
    if (!visitId || !keyNumber.trim() || issuingKeyVisitId === visitId) return;
    setIssuingKeyVisitId(visitId);
    try {
      const res = await apiFetch('/api/key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitId, keyNumber }),
      });
      if (!res.ok) {
        const apiError = await readApiError(res, 'Ошибка выдачи ключа');
        throw new Error(apiError.error);
      }
      setCards((prev) =>
        prev.map((c) =>
          c.id === cardId ? { ...c, keyNumber, keyIssued: true } : c,
        ),
      );
      setActiveVisit((prev) =>
        prev?.id === cardId ? { ...prev, keyNumber, keyIssued: true } : prev,
      );
      setVisitActionError('');
      void fetchScannerEvents();
    } catch (e) {
      console.error('Ошибка выдачи ключа', e);
      setVisitActionError(
        e instanceof Error ? e.message : 'Не удалось выдать ключ',
      );
    } finally {
      setIssuingKeyVisitId(null);
    }
  };

  const handleCategoryChange = async (
    cardId: string,
    visitId: number | undefined,
    categoryIds: number[],
  ) => {
    if (!visitId || savingCategoryVisitId === visitId) return;
    setSavingCategoryVisitId(visitId);

    try {
      const res = await apiFetch('/api/visit/category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitId, categoryIds }),
      });
      if (!res.ok) {
        const apiError = await readApiError(res, 'Ошибка сохранения категории');
        throw new Error(apiError.error);
      }
      const data = (await res.json()) as {
        category?: string;
        categoryIds?: number[];
      };
      const savedCategory =
        data.category ?? getCategoryNamesByIds(visitCategories, categoryIds);
      const savedCategoryIds = data.categoryIds ?? categoryIds;
      setCards((prev) =>
        prev.map((c) =>
          c.id === cardId
            ? { ...c, category: savedCategory, categoryIds: savedCategoryIds }
            : c,
        ),
      );
      setActiveVisit((prev) =>
        prev?.id === cardId
          ? { ...prev, category: savedCategory, categoryIds: savedCategoryIds }
          : prev,
      );
      setVisitActionError('');
      void fetchScannerEvents();
    } catch (e) {
      console.error('Ошибка сохранения категории:', e);
      setVisitActionError(
        e instanceof Error ? e.message : 'Не удалось сохранить цель визита',
      );
    } finally {
      setSavingCategoryVisitId(null);
    }
  };

  const handleDelete = () => {
    if (cardToDelete) {
      setCards((prev) => prev.filter((c) => c.id !== cardToDelete));
      setIsDeleteOpen(false);
    }
  };

  const activeCategoryIds =
    activeVisit?.categoryIds && activeVisit.categoryIds.length > 0
      ? activeVisit.categoryIds
      : splitVisitCategories(activeVisit?.category)
          .map(
            (name) =>
              visitCategories.find((category) => category.name === name)?.id,
          )
          .filter((id): id is number => Boolean(id));

  const toggleActiveVisitCategory = (categoryId: number) => {
    if (!activeVisit || savingCategoryVisitId === activeVisit.visitId) return;

    const nextCategoryIds = activeCategoryIds.includes(categoryId)
      ? activeCategoryIds.filter((id) => id !== categoryId)
      : [...activeCategoryIds, categoryId];

    void handleCategoryChange(
      activeVisit.id,
      activeVisit.visitId,
      nextCategoryIds,
    );
  };

  return (
    <div className="min-h-screen p-4 font-sans md:p-6">
      <div className="w-full space-y-4">
        {/* ШАПКА И КНОПКИ */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Монитор входов
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Управление гостями, выдача ключей и пометки
            </p>
          </div>

          <div className="flex flex-wrap gap-3 w-full sm:w-auto">
            <Button
              variant={scannerStatus === 'connected' ? 'default' : 'outline'}
              className={
                scannerStatus === 'connected'
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : ''
              }
              onClick={connectScanner}
              disabled={
                scannerStatus === 'connected' ||
                scannerStatus === 'connecting' ||
                scannerStatus === 'reconnecting'
              }
            >
              {scannerStatus === 'connected' ? (
                <>
                  <Usb className="w-4 h-4 mr-2" /> {getScannerStatusText(scannerStatus)}
                </>
              ) : scannerStatus === 'connecting' ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />{' '}
                  {getScannerStatusText(scannerStatus)}
                </>
              ) : scannerStatus === 'reconnecting' ? (
                <>
                  <RotateCw className="w-4 h-4 mr-2 animate-spin" />{' '}
                  {getScannerStatusText(scannerStatus)}
                </>
              ) : (
                <>
                  <Unplug className="w-4 h-4 mr-2 text-destructive" />{' '}
                  Подключить сканер
                </>
              )}
            </Button>

            {scannerStatus !== 'connected' && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void reconnectScanner()}
                disabled={scannerStatus === 'connecting'}
              >
                <RefreshCcw className="w-4 h-4 mr-2" />
                Переподключить
              </Button>
            )}

            {scannerStatus === 'connected' && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsDisconnectOpen(true)}
              >
                <WifiOff className="w-4 h-4 mr-2" />
                Отключить
              </Button>
            )}

            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void fetchScannerEvents();
                setIsScannerJournalOpen(true);
              }}
            >
              <History className="w-4 h-4 mr-2" />
              Журнал
            </Button>

            <Button
              variant="outline"
              onClick={() => setIsSearchOpen(true)}
              className="flex-1 sm:flex-none"
            >
              <Search className="w-4 h-4 mr-2" />
              Ручной поиск
            </Button>
            <Button
              onClick={() => {
                setRegForm(getEmptyReceptionForm());
                setRegCandidate(null);
                setRestoreCandidate(null);
                setRegError('');
                setIsRegOpen(true);
              }}
              className="flex-1 sm:flex-none"
            >
              <UserPlus className="w-4 h-4 mr-2" />
              Новый клиент
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-md border bg-card px-4 py-3 text-sm md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge
              variant={scannerStatus === 'connected' ? 'default' : 'outline'}
              className={
                scannerStatus === 'connected'
                  ? 'bg-green-600 text-white hover:bg-green-600'
                  : scannerStatus === 'reconnecting'
                    ? 'border-amber-500/40 text-amber-600 dark:text-amber-300'
                    : scannerStatus === 'disconnected'
                      ? 'border-destructive/40 text-destructive'
                      : ''
              }
            >
              {getScannerStatusText(scannerStatus)}
            </Badge>
            <span className="min-w-0 whitespace-normal break-words text-muted-foreground">
              {scannerLastEvent ||
                'Подключите сканер один раз, дальше CRM попробует восстановить разрешенный порт автоматически.'}
            </span>
            <HelpTooltip>
              В Chrome автопереподключение работает только для порта, которому
              уже дали доступ через кнопку подключения.
            </HelpTooltip>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {pendingScanCount > 0 && (
              <Badge
                variant="outline"
                className="border-amber-500/40 text-amber-600 dark:text-amber-300"
              >
                QR в очереди: {pendingScanCount}
              </Badge>
            )}
            {queuedVisits.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => closeActiveVisit()}
              >
                <Clock3 className="mr-2 h-4 w-4" />
                Новых входов: {queuedVisits.length}
              </Button>
            )}
            {scannerLastError && (
              <span
                className="inline-flex max-w-full items-start gap-1 whitespace-normal break-words text-destructive"
                title={scannerLastError}
              >
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{scannerLastError}</span>
              </span>
            )}
          </div>
        </div>

        {/* МОБИЛЬНЫЙ СПИСОК */}
        <div className="space-y-2 md:hidden">
          {cards.length === 0 ? (
            <div className="rounded-md border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
              Ожидание сканирований...
            </div>
          ) : (
            cards.map((card) => {
              const cleanTime = card.time.replace(/[^0-9:]/g, '') || '-';
              const categoryNames = getVisitCategoryNames(card);
              const visibleCategoryNames = categoryNames.slice(0, 3);
              const hiddenCategoryCount = Math.max(
                0,
                categoryNames.length - visibleCategoryNames.length,
              );
              const isRepeated = Boolean(
                card.isRepeated || card.time.includes('🔄'),
              );

              return (
                <div
                  key={card.id}
                  className="rounded-md border bg-card p-3 text-sm"
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setVisitActionError('');
                    setCurrentVisit(card);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setVisitActionError('');
                      setCurrentVisit(card);
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {card.success ? (
                          <Badge
                            variant="outline"
                            className={
                              isRepeated
                                ? 'border-amber-500/40 text-amber-600 dark:text-amber-300'
                                : 'border-primary/40 text-primary'
                            }
                          >
                            {isRepeated ? 'Повтор' : 'Найден'}
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-destructive/40 text-destructive"
                          >
                            Не найден
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {cleanTime}
                        </span>
                      </div>
                      <div className="mt-2 truncate font-semibold">
                        {card.success ? card.name : 'Неизвестный QR'}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {card.success ? `Источник: ${card.source}` : card.qrRaw}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={(event) => {
                        event.stopPropagation();
                        setCardToDelete(card.id);
                        setIsDeleteOpen(true);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="text-muted-foreground">Контакт</div>
                      <div className="mt-1 break-words font-medium">
                        {card.success ? card.phone || '-' : card.qrRaw || '-'}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Ключ</div>
                      <div className="mt-1 font-medium">
                        {card.keyIssued ? `Выдан №${card.keyNumber}` : '-'}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1">
	                            {visibleCategoryNames.length > 0 ? (
	                              <>
	                                {visibleCategoryNames.map((cat) => (
	                                  <span
	                                    key={cat}
	                                    className="rounded border border-border/60 bg-secondary/50 px-1.5 py-0.5 text-xs"
	                                  >
	                                    {cat}
	                                  </span>
	                                ))}
                        {hiddenCategoryCount > 0 && (
                          <span className="rounded border border-border/60 bg-secondary/50 px-1.5 py-0.5 text-xs text-muted-foreground">
                            +{hiddenCategoryCount}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Цель не указана
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ТАБЛИЦА */}
        <div className="hidden overflow-x-auto rounded-md border bg-card shadow-sm md:block">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px]">Статус</TableHead>
                <TableHead className="min-w-[150px]">Клиент</TableHead>
                <TableHead className="min-w-[130px]">Контакты</TableHead>
                <TableHead className="w-[120px]">Время</TableHead>
                <TableHead className="w-[200px]">Цель визита</TableHead>
                <TableHead className="w-[180px]">Ключ</TableHead>
                <TableHead className="w-[50px] text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cards.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="h-24 text-center text-muted-foreground"
                  >
                    Ожидание сканирований...
                  </TableCell>
                </TableRow>
              ) : (
                cards.map((card) => {
                  const cleanTime = card.time.replace(/[^0-9:]/g, '');
                  const categoryNames = getVisitCategoryNames(card);
                  const visibleCategoryNames = categoryNames.slice(0, 3);
                  const hiddenCategoryCount = Math.max(
                    0,
                    categoryNames.length - visibleCategoryNames.length,
                  );
                  const isRepeated = Boolean(
                    card.isRepeated || card.time.includes('🔄'),
                  );

                  return (
                    <TableRow
                      key={card.id}
                      className="cursor-pointer animate-in fade-in slide-in-from-top-2"
                      onClick={() => {
                        setVisitActionError('');
                        setCurrentVisit(card);
                      }}
                    >
                      <TableCell>
                        {card.success ? (
                          <div
                            className={`flex items-center gap-2 font-medium ${
                              isRepeated
                                ? 'text-amber-600 dark:text-amber-300'
                                : 'text-primary'
                            }`}
                          >
                            {isRepeated ? (
                              <RefreshCcw className="w-5 h-5" />
                            ) : (
                              <CheckCircle2 className="w-5 h-5" />
                            )}
                            <Badge
                              variant="outline"
                              className={
                                isRepeated
                                  ? 'border-amber-500/40 text-amber-600 dark:text-amber-300'
                                  : 'border-primary/40 text-primary'
                              }
                            >
                              {isRepeated ? 'Повтор' : 'Найден'}
                            </Badge>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 font-medium text-destructive">
                            <XCircle className="w-5 h-5" />
                            <Badge
                              variant="outline"
                              className="border-destructive/40 text-destructive"
                            >
                              Не найден
                            </Badge>
                          </div>
                        )}
                      </TableCell>

                      <TableCell>
                        <div className="font-semibold text-foreground truncate max-w-[200px]">
                          {card.success ? card.name : 'НЕИЗВЕСТНЫЙ'}
                        </div>
                        {card.success && (
                          <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-[200px]">
                            Источник: {card.source}
                          </div>
                        )}
                      </TableCell>

                      <TableCell className="max-w-[220px] whitespace-normal break-words text-muted-foreground">
                        {card.success ? (
                          card.phone
                        ) : (
                          <span className="break-all font-mono text-xs">
                            {card.qrRaw}
                          </span>
                        )}
                      </TableCell>

                      <TableCell className="text-muted-foreground font-medium text-sm">
                        <div className="flex items-center gap-1.5">
                          {isRepeated ? (
                            <>
                              <RefreshCcw className="w-3.5 h-3.5 text-amber-600 dark:text-amber-300" />
                              <span>{cleanTime}</span>
                            </>
                          ) : card.success ? (
                            <>
                              <LogIn className="w-3.5 h-3.5 text-primary" />
                              <span>{cleanTime}</span>
                            </>
                          ) : (
                            <>
                              <XCircle className="w-3.5 h-3.5 text-destructive" />
                              <span>{cleanTime}</span>
                            </>
                          )}
                        </div>
                      </TableCell>

                      <TableCell>
                        {card.success ? (
                          <div className="flex max-w-[220px] flex-wrap gap-1">
                            {visibleCategoryNames.length > 0 ? (
                              <>
                                {visibleCategoryNames.map((cat) => (
                                <span
                                  key={cat}
                                  className="rounded border border-border/60 bg-secondary/50 px-1.5 py-0.5 text-xs"
                                >
                                  {cat}
                                </span>
                                ))}
                                {hiddenCategoryCount > 0 && (
                                  <span className="rounded border border-border/60 bg-secondary/50 px-1.5 py-0.5 text-xs text-muted-foreground">
                                    +{hiddenCategoryCount}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-sm text-muted-foreground">
                                -
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">
                            -
                          </span>
                        )}
                      </TableCell>

                      <TableCell>
                        {card.success ? (
                          card.keyIssued ? (
                            <div className="inline-flex items-center px-2.5 py-1.5 rounded-md bg-primary/10 text-primary text-sm font-medium border border-primary/20">
                              Выдан №{card.keyNumber}
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              -
                            </span>
                          )
                        ) : (
                          <span className="text-muted-foreground text-sm">
                            -
                          </span>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-8 w-8"
                          onClick={(event) => {
                            event.stopPropagation();
                            setCardToDelete(card.id);
                            setIsDeleteOpen(true);
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* МОДАЛКА: ПОИСК */}
      <Dialog open={isSearchOpen} onOpenChange={setIsSearchOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search className="w-5 h-5 text-muted-foreground" />
              Поиск клиента
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Введите имя или телефон..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="mb-4"
              autoFocus
            />
            <div className="max-h-[300px] overflow-y-auto space-y-2 pr-2">
              {searchQuery.length < 2 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Начните вводить...
                </p>
              ) : searchError ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {searchError}
                </div>
              ) : searchResults.length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground mb-4">
                    Ничего не найдено
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsSearchOpen(false);
                      setRegForm(getEmptyReceptionForm());
                      setRegCandidate(null);
                      setRestoreCandidate(null);
                      setRegError('');
                      setIsRegOpen(true);
                    }}
                  >
                    Создать нового
                  </Button>
                </div>
              ) : (
                searchResults.map((u) => (
                  <button
                    type="button"
                    key={u.id}
                    onClick={() => handleManualVisit(u.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-md border border-dashed p-3 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <span className="min-w-0 truncate font-semibold">
                      {u.name}
                    </span>
                    <span className="shrink-0 text-sm text-muted-foreground">
                      {u.phone}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* МОДАЛКА: РЕГИСТРАЦИЯ */}
      <Dialog open={isRegOpen} onOpenChange={setIsRegOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary">
              <UserPlus className="w-5 h-5" />
              {restoreCandidate ? 'Восстановить клиента' : 'Новый клиент'}
            </DialogTitle>
            <DialogDescription>
              {restoreCandidate
                ? 'Проверьте данные архивного клиента перед возвратом в актуальную базу.'
                : 'Телефон проверяется на дубли и хранится в едином формате.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRegisterSubmit} className="space-y-4 pt-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Фамилия и имя
                </label>
                <Input
                  required
                  placeholder="Иванов Иван"
                  value={regForm.name}
                  onChange={handleNameInput}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Телефон
                </label>
                <Input
                  required
                  type="tel"
                  placeholder="+7 (999) 000-00-00"
                  inputMode="tel"
                  maxLength={18}
                  value={regForm.phone}
                  onChange={handlePhoneInput}
                />
              </div>
            </div>
            {regCandidate && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                <div className="font-medium text-amber-700 dark:text-amber-300">
                  {regCandidate.status === 'archived'
                    ? 'Такой клиент уже есть в архиве'
                    : 'Такой клиент уже есть в базе'}
                </div>
                <div className="mt-1 text-muted-foreground">
                  {regCandidate.name} · {regCandidate.phone}
                  {regCandidate.stats
                    ? ` · ${regCandidate.stats.visitCount} визитов`
                    : ''}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3 w-full"
                  onClick={() =>
                    regCandidate.status === 'archived'
                      ? openReceptionRestore(regCandidate)
                      : void handleUseExistingClient()
                  }
                >
                  {regCandidate.status === 'archived'
                    ? 'Восстановить и отредактировать'
                    : 'Использовать существующего клиента'}
                </Button>
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium">
                Источник
              </label>
              <Select
                value={regForm.sourceId}
                onValueChange={(sourceId) => {
                  const source = clientSources.find(
                    (item) => String(item.id) === sourceId,
                  );
                  setRegForm({
                    ...regForm,
                    sourceId,
                    source: source?.name || regForm.source,
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите источник" />
                </SelectTrigger>
                <SelectContent>
                  {clientSources.map((source) => (
                    <SelectItem key={source.id} value={String(source.id)}>
                      {source.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">
                Заметка
              </label>
              <textarea
                value={regForm.note}
                onChange={(e) =>
                  setRegForm({ ...regForm, note: e.target.value })
                }
                className="min-h-[120px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Что важно знать администраторам и менеджеру"
              />
            </div>

            {regError && (
              <div className="text-sm font-medium text-destructive bg-destructive/10 p-3 rounded-md">
                {regError}
              </div>
            )}

            <Button type="submit" disabled={regLoading} className="w-full mt-2">
              {regLoading
                ? 'Сохранение...'
                : restoreCandidate
                  ? 'Восстановить и пропустить'
                  : 'Создать и пропустить'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* МОДАЛКА: ВИЗИТ ПОСЛЕ СКАНА */}
      <Dialog
        open={Boolean(activeVisit)}
        onOpenChange={(open) => !open && closeActiveVisit()}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[760px]">
          <DialogHeader>
            <DialogTitle className="flex min-w-0 items-center gap-2 pr-8">
              {activeVisit?.success ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
              ) : (
                <XCircle className="h-5 w-5 shrink-0 text-destructive" />
              )}
              <span className="min-w-0 truncate">
                {activeVisit?.success ? activeVisit.name : 'Клиент не найден'}
              </span>
            </DialogTitle>
            <DialogDescription>
              {activeVisit?.success
                ? 'Проверьте клиента, укажите цель визита и номер ключа.'
                : 'QR не найден. Найдите клиента вручную или создайте нового.'}
              {queuedVisits.length > 0
                ? ` В очереди еще ${queuedVisits.length} входов.`
                : ''}
            </DialogDescription>
          </DialogHeader>

          {activeVisit && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Телефон</div>
                  <div className="mt-1 font-medium">
                    {activeVisit.success ? activeVisit.phone || '-' : '-'}
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Источник</div>
                  <div className="mt-1 font-medium">
                    {activeVisit.success ? activeVisit.source || '-' : '-'}
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Время</div>
                  <div className="mt-1 font-medium">
                    {activeVisit.time.replace(/[^0-9:]/g, '') || '-'}
                  </div>
                </div>
              </div>

              {!activeVisit.success && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
                  QR не найден в базе:{' '}
                  <span className="font-mono">{activeVisit.qrRaw}</span>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIsSearchOpen(true);
                      }}
                    >
                      <Search className="mr-2 h-4 w-4" />
                      Найти вручную
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        setRegForm(getEmptyReceptionForm());
                        setRegCandidate(null);
                        setRestoreCandidate(null);
                        setRegError('');
                        setIsRegOpen(true);
                      }}
                    >
                      <UserPlus className="mr-2 h-4 w-4" />
                      Создать клиента
                    </Button>
                  </div>
                </div>
              )}

              {queuedVisits.length > 0 && (
                <div className="rounded-md border bg-secondary/30 p-3 text-sm">
                  <div className="mb-2 font-medium">Очередь входов</div>
                  <div className="space-y-1">
                    {queuedVisits.slice(0, 3).map((visit) => (
                      <button
                        key={visit.id}
                        type="button"
                        className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1 text-left hover:bg-background"
                        onClick={() => {
                          setQueuedVisits((prev) =>
                            prev.filter((item) => item.id !== visit.id),
                          );
                          setCurrentVisit(visit);
                        }}
                      >
                        <span className="min-w-0 truncate">
                          {visit.success ? visit.name : 'QR не найден'}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {visit.time.replace(/[^0-9:]/g, '') || '-'}
                        </span>
                      </button>
                    ))}
                  </div>
                  {queuedVisits.length > 3 && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Еще {queuedVisits.length - 3} входов будут доступны по
                      кнопке “Следующий вход”.
                    </div>
                  )}
                </div>
              )}

              {activeVisit.isRepeated && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                  Это повторный скан за последние несколько минут. Новый визит
                  не создан, открыта уже существующая запись.
                </div>
              )}

              {visitActionError && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {visitActionError}
                </div>
              )}

              {activeVisit.success && (
                <>
                  <div>
                    <div className="mb-2 text-sm font-medium">Цель визита</div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {visitCategories.map((category) => {
                        const isSelected = activeCategoryIds.includes(category.id);
                        const isSavingCategory =
                          savingCategoryVisitId === activeVisit.visitId;

                        return (
                          <button
                            key={category.id}
                            type="button"
                            aria-pressed={isSelected}
                            disabled={isSavingCategory}
                            onClick={() => toggleActiveVisitCategory(category.id)}
                            className={`flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-muted-foreground/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
                              isSelected
                                ? 'border-primary bg-primary/15 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)]'
                                : 'border-border hover:bg-secondary'
                            } disabled:cursor-not-allowed disabled:opacity-60`}
                          >
                            <span
                              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                isSelected
                                  ? 'border-primary bg-primary'
                                  : 'border-muted-foreground/40'
                              }`}
                            >
                              {isSelected && (
                                <Check className="h-3 w-3 text-primary-foreground" />
                              )}
                            </span>
                            <span>{category.name}</span>
	                          </button>
	                        );
                      })}
                      {visitCategories.length === 0 && (
                        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground sm:col-span-2">
                          Сначала создайте категории визитов в справочниках CRM.
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-sm font-medium">Ключ</div>
                    {activeVisit.keyIssued ? (
                      <div className="inline-flex items-center rounded-md border border-primary/20 bg-primary/10 px-3 py-2 text-sm font-medium text-primary">
                        Выдан №{activeVisit.keyNumber}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                          placeholder="Номер ключа"
                          inputMode="numeric"
                          value={activeVisit.keyNumber}
                          disabled={issuingKeyVisitId === activeVisit.visitId}
                          onChange={(event) =>
                            handleKeyInput(activeVisit.id, event.target.value)
                          }
                        />
                        <Button
                          type="button"
                          disabled={
                            !activeVisit.keyNumber.trim() ||
                            issuingKeyVisitId === activeVisit.visitId
                          }
                          onClick={() =>
                            void handleIssueKey(
                              activeVisit.visitId,
                              activeVisit.keyNumber,
                              activeVisit.id,
                            )
                          }
                        >
                          {issuingKeyVisitId === activeVisit.visitId
                            ? 'Выдаем...'
                            : 'Выдать ключ'}
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={closeActiveVisit}>
              {queuedVisits.length > 0 ? 'Следующий вход' : 'Закрыть'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* МОДАЛКА: ЖУРНАЛ СКАНЕРА */}
      <Dialog open={isScannerJournalOpen} onOpenChange={setIsScannerJournalOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[880px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5 text-muted-foreground" />
              Журнал сканера
            </DialogTitle>
            <DialogDescription>
              Последние подключения, отключения, повторы и ошибки QR.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            {scannerEvents.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                Событий сканера пока нет.
              </div>
            ) : (
              scannerEvents.map((event) => (
                <div
                  key={event.id}
                  className="grid gap-3 rounded-md border p-3 text-sm md:grid-cols-[160px_minmax(0,1fr)_140px]"
                >
                  <div className="space-y-1">
                    <Badge
                      variant="outline"
                      className={
                        event.severity === 'error'
                          ? 'border-destructive/40 text-destructive'
                          : event.severity === 'warning'
                            ? 'border-amber-500/40 text-amber-600 dark:text-amber-300'
                            : ''
                      }
                    >
                      {getScannerEventLabel(event.eventType)}
                    </Badge>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(event.createdAt)}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div
                      className="whitespace-normal break-words font-medium leading-snug"
                      title={event.message || event.status || ''}
                    >
                      {event.message || event.status || '-'}
                    </div>
	                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
	                      {event.user?.name && <span>Клиент: {event.user.name}</span>}
	                      {event.qrPreview && (
	                        <span>
	                          QR: {event.qrPreview}
	                          {event.qrHash
	                            ? ` · hash ${event.qrHash.slice(0, 8)}`
	                            : ''}
	                        </span>
	                      )}
	                      {event.code && <span>Код: {event.code}</span>}
	                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground md:text-right">
                    {event.account?.name || event.account?.email || 'CRM'}
                  </div>
                </div>
              ))
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => void fetchScannerEvents()}
            >
              <RefreshCcw className="mr-2 h-4 w-4" />
              Обновить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* МОДАЛКА: УДАЛЕНИЕ */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Скрыть запись с экрана?</DialogTitle>
            <DialogDescription>
              Это уберет карточку только из текущего монитора. В истории
              визитов запись останется.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setIsDeleteOpen(false)}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Скрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* МОДАЛКА: ОТКЛЮЧЕНИЕ СКАНЕРА */}
      <Dialog open={isDisconnectOpen} onOpenChange={setIsDisconnectOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Отключить сканер?</DialogTitle>
            <DialogDescription>
              Поток QR остановится, пока вы снова не подключите устройство.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setIsDisconnectOpen(false)}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={() => void disconnectScanner()}>
              Отключить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
