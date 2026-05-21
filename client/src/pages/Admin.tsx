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
} from 'lucide-react';

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
import { apiFetch } from '@/lib/api';
import type { ReferenceItem } from '@/lib/references';
import { fetchReferences } from '@/lib/references';

const socket = io(API_URL);

const EMPTY_RECEPTION_CLIENT_FORM = {
  name: '',
  phone: '',
  sourceId: '',
  source: 'Ресепшн (Админ)',
  note: '',
};

interface VisitCard {
  id: string;
  success: boolean;
  time: string;
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
}

interface NavigatorWithSerial extends Navigator {
  serial?: {
    requestPort: () => Promise<SerialPortLike>;
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

function getCategoryNamesByIds(categories: ReferenceItem[], categoryIds: number[]) {
  const names = categoryIds
    .map((id) => categories.find((category) => category.id === id)?.name)
    .filter(Boolean);
  return names.join(', ');
}

export default function AdminPage() {
  const [cards, setCards] = useState<VisitCard[]>([]);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isRegOpen, setIsRegOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [cardToDelete, setCardToDelete] = useState<string | null>(null);
  const [activeVisit, setActiveVisit] = useState<VisitCard | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scannerStatus, setScannerStatus] = useState<
    'disconnected' | 'connecting' | 'connected'
  >('disconnected');
  const portRef = useRef<SerialPortLike | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(
    null,
  );
  const scannerActiveRef = useRef(false);

  const [regForm, setRegForm] = useState(EMPTY_RECEPTION_CLIENT_FORM);
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState('');
  const [regCandidate, setRegCandidate] =
    useState<ExistingClientCandidate | null>(null);
  const [restoreCandidate, setRestoreCandidate] =
    useState<ExistingClientCandidate | null>(null);
  const [clientSources, setClientSources] = useState<ReferenceItem[]>([]);
  const [visitCategories, setVisitCategories] = useState<ReferenceItem[]>([]);

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

  useEffect(() => {
    fetchHistory();
  }, []);

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

  useEffect(() => {
    socket.on('scan_result', (data) => {
      const time = new Date().toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      });

      const newCard: VisitCard = {
        id: Date.now().toString(),
        success: data.success,
        time: time,
        isRepeated: data.isRepeated,
        name: data.user?.name || '',
        phone: data.user?.phone || '',
        source: data.user?.source || '-',
        telegramId: data.user?.telegramId,
        vkId: data.user?.vkId,
        webId: data.user?.webId,
        visitId: data.visitId,
        qrRaw: data.id,
        keyNumber: '',
        keyIssued: false,
        category: data.category || '',
        categoryIds: data.categoryIds || [],
      };

      playSound(data.success ? 'success' : 'error');

      setCards((prev) => {
        const filtered = prev.filter(
          (c) =>
            !(newCard.telegramId && c.telegramId === newCard.telegramId) &&
            !(newCard.vkId && c.vkId === newCard.vkId) &&
            !(newCard.webId && c.webId === newCard.webId),
        );
        return [newCard, ...filtered];
      });
      setActiveVisit(newCard);
    });

    return () => {
      socket.off('scan_result');
    };
  }, []);

  const submitScan = async (qrCode: string) => {
    try {
      await apiFetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qr: qrCode }),
      });
    } catch (e) {
      console.error('Ошибка сканера:', e);
    }
  };

  const closeScannerPort = useCallback(async () => {
    scannerActiveRef.current = false;

    const reader = readerRef.current;
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // reader may already be released after a hardware disconnect
      }
      setScannerStatus('disconnected');
      return;
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

    setScannerStatus('disconnected');
  }, []);

  const readScannerLoop = async (port: SerialPortLike) => {
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
                  await submitScan(qrCode);
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
    } finally {
      if (portRef.current === port) {
        await closeScannerPort();
      } else {
        scannerActiveRef.current = false;
        setScannerStatus('disconnected');
      }
    }
  };

  // --- ЛОГИКА СКАНЕРА ---
  const connectScanner = async () => {
    if (scannerStatus !== 'disconnected' || scannerActiveRef.current) return;

    const serial = (navigator as NavigatorWithSerial).serial;

    if (!serial) {
      alert(
        'Ваш браузер не поддерживает Web Serial API. Используйте Google Chrome или Edge.',
      );
      return;
    }

    let port: SerialPortLike | null = null;

    try {
      setScannerStatus('connecting');
      port = await serial.requestPort();
      await port.open({ baudRate: 9600 });
      portRef.current = port;
      scannerActiveRef.current = true;
      setScannerStatus('connected');
      void readScannerLoop(port);
    } catch (error) {
      console.error('Ошибка порта:', error);
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
    }
  };

  useEffect(() => {
    const serial = (navigator as NavigatorWithSerial).serial;
    if (!serial?.addEventListener || !serial.removeEventListener) return;

    const handleDisconnect = (event: Event) => {
      const disconnectedPort = event.target as unknown as SerialPortLike | null;
      if (!portRef.current || disconnectedPort === portRef.current) {
        void closeScannerPort();
      }
    };

    serial.addEventListener('disconnect', handleDisconnect);
    return () => {
      serial.removeEventListener?.('disconnect', handleDisconnect);
      void closeScannerPort();
    };
  }, [closeScannerPort]);

  const playSound = (type: 'success' | 'error') => {
    const url =
      type === 'success'
        ? 'https://www.soundjay.com/buttons/sounds/button-3.mp3'
        : 'https://www.soundjay.com/buttons/sounds/beep-05.mp3';
    const audio = new Audio(url);
    audio.volume = 0.3;
    audio.play().catch(() => {});
  };

  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current);
    }
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await apiFetch(
          `/api/search?q=${encodeURIComponent(searchQuery)}`,
        );
        const data = await res.json();
        setSearchResults(data);
      } catch (e) {
        console.error('Ошибка поиска', e);
      }
    }, 300);
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
    try {
      const res = await apiFetch('/api/manual-visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (res.ok) {
        setIsSearchOpen(false);
        setSearchQuery('');
      }
    } catch (e) {
      console.error('Ошибка ручного добавления', e);
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

      await apiFetch('/api/manual-visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: regData.client.id }),
      });
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
    if (!visitId || !keyNumber.trim()) return;
    try {
      const res = await apiFetch('/api/key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitId, keyNumber }),
      });
      if (res.ok) {
        setCards((prev) =>
          prev.map((c) =>
            c.id === cardId ? { ...c, keyNumber, keyIssued: true } : c,
          ),
        );
        setActiveVisit((prev) =>
          prev?.id === cardId ? { ...prev, keyNumber, keyIssued: true } : prev,
        );
      }
    } catch (e) {
      console.error('Ошибка выдачи ключа', e);
    }
  };

  const handleCategoryChange = async (
    cardId: string,
    visitId: number | undefined,
    categoryIds: number[],
  ) => {
    if (!visitId) return;
    const category = getCategoryNamesByIds(visitCategories, categoryIds);

    setCards((prev) =>
      prev.map((c) =>
        c.id === cardId ? { ...c, category, categoryIds } : c,
      ),
    );
    setActiveVisit((prev) =>
      prev?.id === cardId ? { ...prev, category, categoryIds } : prev,
    );

    try {
      await apiFetch('/api/visit/category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitId, categoryIds }),
      });
    } catch (e) {
      console.error('Ошибка сохранения категории:', e);
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
    if (!activeVisit) return;

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
              disabled={scannerStatus !== 'disconnected'}
            >
              {scannerStatus === 'connected' ? (
                <>
                  <Usb className="w-4 h-4 mr-2" /> Сканер активен
                </>
              ) : scannerStatus === 'connecting' ? (
                <>
                  <Usb className="w-4 h-4 mr-2 animate-pulse" /> Подключение...
                </>
              ) : (
                <>
                  <Unplug className="w-4 h-4 mr-2 text-destructive" />{' '}
                  Подключить сканер
                </>
              )}
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

        {/* ТАБЛИЦА */}
        <div className="border rounded-md bg-card shadow-sm overflow-x-auto">
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

                  return (
                    <TableRow
                      key={card.id}
                      className="animate-in fade-in slide-in-from-top-2"
                    >
                      <TableCell>
                        {card.success ? (
                          <div className="flex items-center gap-2 text-primary font-medium">
                            <CheckCircle2 className="w-5 h-5" />
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-muted-foreground font-medium">
                            <XCircle className="w-5 h-5" />
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

                      <TableCell className="text-muted-foreground">
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
                          {card.isRepeated || card.time.includes('🔄') ? (
                            <>
                              <RefreshCcw className="w-3.5 h-3.5" />
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
                            {card.category ? (
                              splitVisitCategories(card.category).map((cat) => (
                                <span
                                  key={cat}
                                  className="rounded border border-border/60 bg-secondary/50 px-1.5 py-0.5 text-xs"
                                >
                                  {cat}
                                </span>
                              ))
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
                          onClick={() => {
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
        onOpenChange={(open) => !open && setActiveVisit(null)}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[760px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {activeVisit?.success ? (
                <CheckCircle2 className="h-5 w-5 text-primary" />
              ) : (
                <XCircle className="h-5 w-5 text-destructive" />
              )}
              {activeVisit?.success ? activeVisit.name : 'Клиент не найден'}
            </DialogTitle>
            <DialogDescription>
              Проверьте клиента, укажите цель визита и номер ключа.
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
                </div>
              )}

              {activeVisit.success && (
                <>
                  <div>
                    <div className="mb-2 text-sm font-medium">Цель визита</div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {visitCategories.map((category) => {
                        const isSelected = activeCategoryIds.includes(category.id);

                        return (
                          <button
                            key={category.id}
                            type="button"
                            onClick={() => toggleActiveVisitCategory(category.id)}
                            className={`flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                              isSelected
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border hover:bg-secondary'
                            }`}
                          >
                            <span
                              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                isSelected
                                  ? 'border-primary bg-primary'
                                  : 'border-primary/50'
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
                          onChange={(event) =>
                            handleKeyInput(activeVisit.id, event.target.value)
                          }
                        />
                        <Button
                          type="button"
                          disabled={!activeVisit.keyNumber.trim()}
                          onClick={() =>
                            void handleIssueKey(
                              activeVisit.visitId,
                              activeVisit.keyNumber,
                              activeVisit.id,
                            )
                          }
                        >
                          Выдать ключ
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* МОДАЛКА: УДАЛЕНИЕ */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Удалить запись из списка?</DialogTitle>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setIsDeleteOpen(false)}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
