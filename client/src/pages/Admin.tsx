import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
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
  Clock3,
  Loader2,
  RotateCw,
  WifiOff,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { VisitKeyControl } from '@/components/visit-key-control';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Pagination,
  PaginationButton,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
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
import { toast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api';
import { useRealtimeEvent, useRealtimeRefresh } from '@/lib/realtime';
import { cn } from '@/lib/utils';
import type { ReferenceItem } from '@/lib/references';
import { fetchReferences } from '@/lib/references';
import {
  createInitialScannerSnapshot,
  WebSerialScannerLifecycle,
} from '@/lib/web-serial-scanner';
import type {
  ScannerDiagnosticEvent,
  ScannerLifecycleStatus,
  SerialProviderLike,
} from '@/lib/web-serial-scanner';
import {
  createPendingScannerScan,
  recordPendingScannerRetry,
} from '@/lib/scanner-scan-queue';
import type { PendingScannerScan } from '@/lib/scanner-scan-queue';
import { postScannerDiagnosticEvent } from '@/lib/scanner-telemetry';

const EMPTY_RECEPTION_CLIENT_FORM = {
  name: '',
  phone: '',
  sourceId: '',
  source: 'Ресепшн (Админ)',
  note: '',
};

type AudioContextConstructor = typeof AudioContext;

const VISITS_PAGE_SIZE = 12;

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

interface NavigatorWithSerial extends Navigator {
  serial?: SerialProviderLike;
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

function getVisitDisplayMeta(card: VisitCard) {
  const cleanTime = card.time.replace(/[^0-9:]/g, '') || '-';
  const categoryNames = getVisitCategoryNames(card);

  return {
    categoryNames,
    cleanTime,
    isRepeated: Boolean(card.isRepeated || card.time.includes('🔄')),
  };
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

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function getScannerStatusText(status: ScannerLifecycleStatus) {
  if (status === 'connected') return 'Сканер активен';
  if (status === 'connecting') return 'Подключение...';
  if (status === 'reconnecting') return 'Переподключение...';
  if (status === 'terminal') return 'Требуется подключение';
  return 'Сканер отключен';
}

function formatVisitCategoryCount(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) return `${count} цель`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} цели`;
  }

  return `${count} целей`;
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
  const [scannerSnapshot, setScannerSnapshot] = useState(
    createInitialScannerSnapshot,
  );
  const scannerStatus = scannerSnapshot.status;
  const [queuedVisits, setQueuedVisits] = useState<VisitCard[]>([]);
  const activeVisitRef = useRef<VisitCard | null>(null);
  const processedClientEventsRef = useRef<Set<string>>(new Set());
  const scanRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scannerSessionIdRef = useRef(createClientEventId('session'));
  const scannerLifecycleRef = useRef<WebSerialScannerLifecycle | null>(null);
  const scanQueueRef = useRef<PendingScannerScan[]>([]);
  const scanQueueProcessingRef = useRef(false);

  const notifyScannerError = useCallback(
    (title: string, description?: string) => {
      toast.error(title, description ? { description } : undefined);
    },
    [],
  );

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
  const [visitSearchQuery, setVisitSearchQuery] = useState('');
  const [visitPage, setVisitPage] = useState(1);
  const [issuingKeyVisitId, setIssuingKeyVisitId] = useState<number | null>(
    null,
  );
  const [correctingKeyVisitId, setCorrectingKeyVisitId] = useState<
    number | null
  >(null);
  const [savingCategoryVisitId, setSavingCategoryVisitId] = useState<
    number | null
  >(null);

  useEffect(() => {
    activeVisitRef.current = activeVisit;
  }, [activeVisit]);

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

  const fetchHistory = useCallback(async () => {
    try {
      const res = await apiFetch('/api/visits');
      if (res.ok) {
        const history = (await res.json()) as VisitCard[];
        setCards(history);
        setActiveVisit((current) => {
          if (!current?.visitId) return current;
          const updated = history.find(
            (card) => card.visitId === current.visitId,
          );
          return updated ? { ...current, ...updated } : current;
        });
        setQueuedVisits((current) =>
          current.map((queued) => {
            if (!queued.visitId) return queued;
            const updated = history.find(
              (card) => card.visitId === queued.visitId,
            );
            return updated ? { ...queued, ...updated } : queued;
          }),
        );
      }
    } catch (e) {
      console.error('Ошибка загрузки истории:', e);
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
        await postScannerDiagnosticEvent({
          eventType,
          severity: options.severity || 'info',
          status: options.status,
          message: options.message,
          code: options.code,
          source: 'web_serial',
          clientEventId: options.clientEventId || createClientEventId('client'),
          metadata: {
            scannerSessionId: scannerSessionIdRef.current,
            ...options.metadata,
          },
        });
      } catch (e) {
        console.error('Ошибка записи события сканера:', e);
      }
    },
    [],
  );

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  useRealtimeRefresh(['access', 'clients', 'references'], () => {
    void fetchHistory();
  });

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

  useRealtimeEvent<ScanResultPayload>('scan_result', handleIncomingVisit);

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
          const res = await apiFetch('/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              qr: scan.qrCode,
              clientEventId: scan.clientEventId,
              scannerSessionId: scannerSessionIdRef.current,
              deviceLabel:
                scannerLifecycleRef.current?.deviceLabel || 'Web Serial',
            }),
          });
          if (!res.ok) {
            const apiError = await readApiError(res, 'Ошибка сканирования QR');
            throw new Error(apiError.error);
          }

          const data = await res.json();
          scanQueueRef.current.shift();
          syncPendingScanCount();

          if (data.event) {
            handleIncomingVisit(data.event);
          }
        } catch (e) {
          console.error('Ошибка сканера:', e);
          const message = getErrorMessage(e, 'Не удалось отправить QR в CRM');
          recordPendingScannerRetry(scan);
          const delay = Math.min(
            30000,
            1000 * 2 ** Math.min(scan.attempts, 5),
          );

          notifyScannerError(
            message,
            'QR сохранен в очереди и будет отправлен повторно.',
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
    handleIncomingVisit,
    notifyScannerError,
    recordScannerClientEvent,
    syncPendingScanCount,
  ]);

  const enqueueScan = useCallback(
    (qrCode: string) => {
      const normalizedQr = qrCode.trim();
      if (!normalizedQr) return;

      scanQueueRef.current.push(
        createPendingScannerScan(normalizedQr, () =>
          createClientEventId('scan'),
        ),
      );
      syncPendingScanCount();
      void processScanQueue();
    },
    [processScanQueue, syncPendingScanCount],
  );

  const recordLifecycleDiagnostic = useCallback(
    (event: ScannerDiagnosticEvent) =>
      recordScannerClientEvent(event.eventType, {
        code: event.code,
        message: event.message,
        metadata: event.metadata,
        severity: event.severity,
        status: event.status,
      }),
    [recordScannerClientEvent],
  );

  useEffect(() => {
    const serial = (navigator as NavigatorWithSerial).serial;
    if (!serial) {
      setScannerSnapshot({
        lastReason: {
          at: new Date().toISOString(),
          code: 'web_serial_unsupported',
          message:
            'Используйте актуальную версию Google Chrome или Microsoft Edge.',
          title: 'Web Serial недоступен',
        },
        reconnectAttempt: 0,
        status: 'terminal',
      });
      return;
    }

    const lifecycle = new WebSerialScannerLifecycle({
      onDiagnostic: recordLifecycleDiagnostic,
      onError: notifyScannerError,
      onScan: enqueueScan,
      onSessionChange: (sessionId) => {
        scannerSessionIdRef.current = sessionId;
      },
      onStateChange: setScannerSnapshot,
      serial,
    });
    scannerLifecycleRef.current = lifecycle;
    void lifecycle.start();

    return () => {
      clearScanRetryTimer();
      if (scannerLifecycleRef.current === lifecycle) {
        scannerLifecycleRef.current = null;
      }
      void lifecycle.dispose();
    };
  }, [enqueueScan, notifyScannerError, recordLifecycleDiagnostic]);

  const reconnectScanner = async () => {
    const lifecycle = scannerLifecycleRef.current;
    if (!lifecycle) {
      notifyScannerError(
        'Web Serial недоступен',
        'Используйте актуальную версию Google Chrome или Microsoft Edge.',
      );
      return;
    }
    await lifecycle.connectManually();
  };

  const disconnectScanner = async () => {
    await scannerLifecycleRef.current?.disconnectManually();
    setIsDisconnectOpen(false);
  };

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

  const openNewClientDialog = useCallback(() => {
    setRegForm(getEmptyReceptionForm());
    setRegCandidate(null);
    setRestoreCandidate(null);
    setRegError('');
    setIsRegOpen(true);
  }, [getEmptyReceptionForm]);

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
    } catch (e) {
      console.error('Ошибка выдачи ключа', e);
      setVisitActionError(
        e instanceof Error ? e.message : 'Не удалось выдать ключ',
      );
    } finally {
      setIssuingKeyVisitId(null);
    }
  };

  const handleCorrectKey = async (
    visitId: number | undefined,
    keyNumber: string,
    cardId: string,
  ) => {
    if (!visitId || correctingKeyVisitId === visitId) return;
    setCorrectingKeyVisitId(visitId);

    try {
      const res = await apiFetch('/api/key', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitId, keyNumber }),
      });
      if (!res.ok) {
        const apiError = await readApiError(
          res,
          'Ошибка изменения номера ключа',
        );
        throw new Error(apiError.error);
      }

      const data = (await res.json()) as { keyNumber?: string };
      const savedKeyNumber = data.keyNumber || keyNumber;
      setCards((current) =>
        current.map((card) =>
          card.visitId === visitId || card.id === cardId
            ? { ...card, keyNumber: savedKeyNumber, keyIssued: true }
            : card,
        ),
      );
      setActiveVisit((current) =>
        current?.visitId === visitId || current?.id === cardId
          ? { ...current, keyNumber: savedKeyNumber, keyIssued: true }
          : current,
      );
      setVisitActionError('');
      toast.success('Номер ключа изменен', {
        description: `Теперь выдан ключ №${savedKeyNumber}`,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Не удалось изменить номер ключа';
      toast.error('Не удалось изменить номер ключа', {
        description: message,
      });
      throw error;
    } finally {
      setCorrectingKeyVisitId(null);
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

  const openVisitDetails = (card: VisitCard) => {
    setVisitActionError('');
    setCurrentVisit(card);
  };

  const renderVisitCategoryStatus = (card: VisitCard) => {
    const { categoryNames } = getVisitDisplayMeta(card);

    if (!card.success) {
      return <span className="text-sm text-muted-foreground">-</span>;
    }

    if (categoryNames.length === 0) {
      return (
        <Badge
          variant="outline"
          className="h-6 rounded-full border-destructive/25 bg-destructive/10 px-2.5 text-xs text-destructive hover:bg-destructive/10 dark:border-destructive/30"
        >
          Не указана
        </Badge>
      );
    }

    return (
      <Badge
        variant="outline"
        className="h-6 rounded-full border-emerald-500/25 bg-emerald-500/10 px-2.5 text-xs text-emerald-700 hover:bg-emerald-500/10 dark:border-emerald-400/25 dark:text-emerald-300"
        title={categoryNames.join(', ')}
      >
        {formatVisitCategoryCount(categoryNames.length)}
      </Badge>
    );
  };

  const renderVisitDeleteButton = (card: VisitCard) => (
    <Button
      variant="ghost"
      size="icon-sm"
      className="shrink-0 rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      onClick={(event) => {
        event.stopPropagation();
        setCardToDelete(card.id);
        setIsDeleteOpen(true);
      }}
      aria-label="Удалить запись входа"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );

  const normalizedVisitSearchQuery = visitSearchQuery.trim().toLowerCase();
  const filteredVisitCards = useMemo(() => {
    if (!normalizedVisitSearchQuery) return cards;

    return cards.filter((card) => {
      const { cleanTime } = getVisitDisplayMeta(card);
      const searchableValues = [
        card.success ? 'найден' : 'не найден',
        card.name,
        card.phone,
        card.source,
        card.qrRaw,
        card.category,
        card.time,
        cleanTime,
        card.keyIssued ? `ключ ${card.keyNumber}` : 'ключ не выдан',
      ];

      return searchableValues.some((value) =>
        (value || '').toLowerCase().includes(normalizedVisitSearchQuery),
      );
    });
  }, [cards, normalizedVisitSearchQuery]);

  const visitPageCount = Math.max(
    1,
    Math.ceil(filteredVisitCards.length / VISITS_PAGE_SIZE),
  );
  const currentVisitPage = Math.min(visitPage, visitPageCount);
  const paginatedVisitCards = filteredVisitCards.slice(
    (currentVisitPage - 1) * VISITS_PAGE_SIZE,
    currentVisitPage * VISITS_PAGE_SIZE,
  );
  const visitResultStart =
    filteredVisitCards.length === 0
      ? 0
      : (currentVisitPage - 1) * VISITS_PAGE_SIZE + 1;
  const visitResultEnd = Math.min(
    currentVisitPage * VISITS_PAGE_SIZE,
    filteredVisitCards.length,
  );
  const visitPaginationItems = useMemo<Array<number | 'ellipsis-start' | 'ellipsis-end'>>(
    () => {
      if (visitPageCount <= 5) {
        return Array.from({ length: visitPageCount }, (_, index) => index + 1);
      }

      const items: Array<number | 'ellipsis-start' | 'ellipsis-end'> = [1];
      if (currentVisitPage > 3) items.push('ellipsis-start');

      const start = Math.max(2, currentVisitPage - 1);
      const end = Math.min(visitPageCount - 1, currentVisitPage + 1);

      for (let page = start; page <= end; page += 1) {
        items.push(page);
      }

      if (currentVisitPage < visitPageCount - 2) items.push('ellipsis-end');
      items.push(visitPageCount);

      return items;
    },
    [currentVisitPage, visitPageCount],
  );

  useEffect(() => {
    setVisitPage(1);
  }, [visitSearchQuery]);

  useEffect(() => {
    setVisitPage((page) => Math.max(1, Math.min(page, visitPageCount)));
  }, [visitPageCount]);

  return (
    <div className="min-h-screen font-sans">
      <div className="w-full space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="sr-only">Монитор входов</h1>
          <div className="relative w-full md:max-w-[28rem]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={visitSearchQuery}
              onChange={(event) => setVisitSearchQuery(event.target.value)}
              placeholder="Поиск визитов"
              className="pl-9"
            />
          </div>

          <div className="grid w-full grid-cols-2 gap-2 md:flex md:w-auto md:flex-nowrap md:justify-end">
            <Button
              variant={scannerStatus === 'connected' ? 'default' : 'outline'}
              className={cn(
                'col-span-2 w-full md:col-span-1 md:w-auto',
                scannerStatus === 'connected' &&
                  'bg-green-600 text-white hover:bg-green-700',
              )}
              onClick={() => void reconnectScanner()}
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
                  {scannerStatus === 'terminal'
                    ? 'Подключить снова'
                    : 'Подключить сканер'}
                </>
              )}
            </Button>

            {scannerStatus === 'connected' && (
              <Button
                type="button"
                variant="outline"
                className="w-full md:w-auto"
                onClick={() => setIsDisconnectOpen(true)}
              >
                <WifiOff className="w-4 h-4 mr-2" />
                Отключить
              </Button>
            )}

            <Button
              variant="outline"
              onClick={() => setIsSearchOpen(true)}
              className="w-full md:w-auto"
            >
              <Search className="w-4 h-4 mr-2" />
              Ручной поиск
            </Button>
            <Button onClick={openNewClientDialog} className="w-full md:w-auto">
              <UserPlus className="w-4 h-4 mr-2" />
              Новый клиент
            </Button>
          </div>
        </div>

        {scannerSnapshot.lastReason && (
          <div
            role="status"
            className={cn(
              'flex flex-col gap-1 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between',
              scannerStatus === 'terminal'
                ? 'border-destructive/35 bg-destructive/5'
                : scannerStatus === 'reconnecting'
                  ? 'border-amber-500/35 bg-amber-500/5'
                  : 'border-border/70 bg-muted/30',
            )}
          >
            <div className="min-w-0">
              <p className="font-medium text-foreground">
                {scannerSnapshot.lastReason.title}
              </p>
              <p className="mt-0.5 text-muted-foreground">
                {scannerSnapshot.lastReason.message}
              </p>
            </div>
            <time
              className="shrink-0 text-xs text-muted-foreground"
              dateTime={scannerSnapshot.lastReason.at}
            >
              {new Date(scannerSnapshot.lastReason.at).toLocaleTimeString(
                'ru-RU',
                { hour: '2-digit', minute: '2-digit', second: '2-digit' },
              )}
            </time>
          </div>
        )}

        {(pendingScanCount > 0 || queuedVisits.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
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
          </div>
        )}

        <section>
          <div className="overflow-hidden rounded-2xl bg-card shadow-sm shadow-foreground/5">
            <div className="overflow-x-auto">
              <div className="min-w-[860px] overflow-hidden bg-background">
                <Table className="min-w-[860px]">
                  <TableHeader className="[&_tr]:border-0">
                    <TableRow className="border-0 bg-muted/45 hover:bg-muted/45">
                      <TableHead className="h-12 px-5 text-xs font-medium text-muted-foreground">
                        Клиент
                      </TableHead>
                      <TableHead className="h-12 px-5 text-xs font-medium text-muted-foreground">
                        Контакты
                      </TableHead>
                      <TableHead className="h-12 px-5 text-xs font-medium text-muted-foreground">
                        Время
                      </TableHead>
                      <TableHead className="h-12 px-5 text-xs font-medium text-muted-foreground">
                        Цель
                      </TableHead>
                      <TableHead className="h-12 px-5 text-xs font-medium text-muted-foreground">
                        Ключ
                      </TableHead>
                      <TableHead className="h-12 px-5 text-right text-xs font-medium text-muted-foreground" />
                    </TableRow>
                  </TableHeader>
                  <TableBody
                    key={currentVisitPage}
                    className="crm-table-page"
                  >
                    {filteredVisitCards.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="h-32 text-center text-sm text-muted-foreground"
                        >
                          {cards.length === 0
                            ? 'Ожидание сканирований...'
                            : 'По этому поиску визитов нет'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedVisitCards.map((card) => {
                        const { cleanTime, isRepeated } =
                          getVisitDisplayMeta(card);

                        return (
                          <TableRow
                            key={card.id}
                            className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/30"
                            onClick={() => openVisitDetails(card)}
                          >
                            <TableCell className="px-5 py-4">
                              <div className="flex min-w-[240px] items-start gap-3">
                                <div className="min-w-0">
                                  <div
                                    className={cn(
                                      'max-w-[260px] truncate font-semibold leading-5',
                                      !card.success && 'text-destructive',
                                    )}
                                  >
                                    {card.success ? card.name : 'Неизвестный QR'}
                                  </div>
                                  <div className="mt-1 max-w-[260px] truncate text-xs text-muted-foreground">
                                    {card.success
                                      ? card.source || 'Источник не указан'
                                      : card.qrRaw || '-'}
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="max-w-[240px] whitespace-normal break-words px-5 py-4 text-muted-foreground">
                              {card.success ? (
                                card.phone || '-'
                              ) : (
                                <span className="break-all font-mono text-xs">
                                  {card.qrRaw || '-'}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="px-5 py-4 text-sm text-muted-foreground">
                              <div className="flex items-center gap-2">
                                {isRepeated ? (
                                  <RefreshCcw className="h-3.5 w-3.5 text-amber-600 dark:text-amber-300" />
                                ) : card.success ? (
                                  <LogIn className="h-3.5 w-3.5 text-primary" />
                                ) : (
                                  <XCircle className="h-3.5 w-3.5 text-destructive" />
                                )}
                                <span className="font-medium text-foreground">
                                  {cleanTime}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="px-5 py-4">
                              {renderVisitCategoryStatus(card)}
                            </TableCell>
                            <TableCell className="px-5 py-4">
                              {card.success && card.keyIssued ? (
                                <Badge variant="secondary">
                                  №{card.keyNumber}
                                </Badge>
                              ) : (
                                <span className="text-sm text-muted-foreground">
                                  -
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="px-5 py-4 text-right">
                              {renderVisitDeleteButton(card)}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

            </div>

            {filteredVisitCards.length > 0 && (
              <div className="flex flex-col gap-3 border-t px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <div>
                    {visitResultStart}-{visitResultEnd} из{' '}
                    {filteredVisitCards.length}
                  </div>
                  <Pagination className="mx-0 w-auto justify-start sm:justify-end">
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          disabled={currentVisitPage === 1}
                          onClick={() =>
                            setVisitPage((page) => Math.max(1, page - 1))
                          }
                        />
                      </PaginationItem>
                      {visitPaginationItems.map((item) => (
                        <PaginationItem key={item}>
                          {typeof item === 'number' ? (
                            <PaginationButton
                              isActive={item === currentVisitPage}
                              onClick={() => setVisitPage(item)}
                            >
                              {item}
                            </PaginationButton>
                          ) : (
                            <PaginationEllipsis />
                          )}
                        </PaginationItem>
                      ))}
                      <PaginationItem>
                        <PaginationNext
                          disabled={currentVisitPage === visitPageCount}
                          onClick={() =>
                            setVisitPage((page) =>
                              Math.min(visitPageCount, page + 1),
                            )
                          }
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
            )}
          </div>
        </section>
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
                      <VisitKeyControl
                        keyNumber={activeVisit.keyNumber}
                        isSaving={
                          correctingKeyVisitId === activeVisit.visitId
                        }
                        onSave={(keyNumber) =>
                          handleCorrectKey(
                            activeVisit.visitId,
                            keyNumber,
                            activeVisit.id,
                          )
                        }
                      />
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
