import { useState, useEffect, useRef } from 'react';
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { API_URL } from '@/config';

const socket = io(API_URL);

// Список категорий визита
const VISIT_CATEGORIES = [
  'Первый раз',
  'Мастер класс',
  'Групповая тренировка',
  'Индивидуальная тренировка',
  'Первый турнир',
  'Турнир',
  'Игра на сингл',
  'Игра 2х2',
  'Настольный теннис',
  'Вип раздевалка',
  'Аренда ракетки',
  'Ракетка шефа',
  'Тубус',
];

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
}

interface SearchUser {
  id: number;
  name: string;
  phone: string;
}

export default function AdminPage() {
  const [cards, setCards] = useState<VisitCard[]>([]);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isRegOpen, setIsRegOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [cardToDelete, setCardToDelete] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scannerStatus, setScannerStatus] = useState<
    'disconnected' | 'connected'
  >('disconnected');

  const [regForm, setRegForm] = useState({
    name: '',
    phone: '',
    source: 'Ресепшн (Админ)',
  });
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState('');

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${API_URL}/api/visits`);
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
        category: '',
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
    });

    return () => {
      socket.off('scan_result');
    };
  }, []);

  // --- ЛОГИКА СКАНЕРА ---
  const connectScanner = async () => {
    if (!('serial' in navigator)) {
      alert(
        'Ваш браузер не поддерживает Web Serial API. Используйте Google Chrome или Edge.',
      );
      return;
    }

    try {
      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: 9600 });
      setScannerStatus('connected');

      const textDecoder = new TextDecoderStream();
      port.readable.pipeTo(textDecoder.writable);
      const reader = textDecoder.readable.getReader();

      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          reader.releaseLock();
          break;
        }

        if (value) {
          buffer += value;
          let newlineIndex;
          while ((newlineIndex = buffer.search(/[\r\n]/)) !== -1) {
            const qrCode = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);

            if (qrCode) {
              try {
                await fetch(`${API_URL}/api/scan`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ qr: qrCode }),
                });
              } catch (e) {
                console.error('Ошибка сканера:', e);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Ошибка порта:', error);
      setScannerStatus('disconnected');
    }
  };

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
        const res = await fetch(
          `${API_URL}/api/search?q=${encodeURIComponent(searchQuery)}`,
        );
        const data = await res.json();
        setSearchResults(data);
      } catch (e) {
        console.error('Ошибка поиска', e);
      }
    }, 300);
  }, [searchQuery]);

  const handleManualVisit = async (userId: number) => {
    try {
      const res = await fetch(`${API_URL}/api/manual-visit`, {
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

  const handlePhoneInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^\d\+\-\(\)\s]/g, '');
    setRegForm({ ...regForm, phone: val });
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
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (regForm.name.trim().length < 2) {
      setRegError('Введите корректное имя');
      return;
    }
    if (regForm.phone.replace(/\D/g, '').length < 10) {
      setRegError('Слишком короткий номер телефона');
      return;
    }

    setRegLoading(true);
    setRegError('');

    try {
      const regRes = await fetch(`${API_URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(regForm),
      });

      const regData = await regRes.json();

      if (regRes.ok && regData.user) {
        await fetch(`${API_URL}/api/manual-visit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: regData.user.id }),
        });
        setIsRegOpen(false);
        setRegForm({ name: '', phone: '', source: 'Ресепшн (Админ)' });
      } else {
        setRegError(regData.error || 'Ошибка регистрации');
      }
    } catch (err) {
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
      const res = await fetch(`${API_URL}/api/key`, {
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
      }
    } catch (e) {
      console.error('Ошибка выдачи ключа', e);
    }
  };

  const handleCategoryChange = async (
    cardId: string,
    visitId: number | undefined,
    category: string,
  ) => {
    if (!visitId) return;

    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, category } : c)),
    );

    try {
      await fetch(`${API_URL}/api/visit/category`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitId, category }),
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

  return (
    <div className="min-h-screen p-6 font-sans">
      <div className="max-w-[1400px] mx-auto space-y-6">
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
              disabled={scannerStatus === 'connected'}
            >
              {scannerStatus === 'connected' ? (
                <>
                  <Usb className="w-4 h-4 mr-2" /> Сканер активен
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
              onClick={() => setIsRegOpen(true)}
              className="flex-1 sm:flex-none"
            >
              <UserPlus className="w-4 h-4 mr-2" />
              Новый гость
            </Button>
          </div>
        </div>

        {/* ТАБЛИЦА */}
        <div className="border rounded-md bg-card shadow-sm overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px]">Статус</TableHead>
                <TableHead className="min-w-[150px]">Гость</TableHead>
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

                      {/* НОВАЯ КОЛОНКА: ЦЕЛЬ ВИЗИТА (МУЛЬТИ-СЕЛЕКТ) */}
                      <TableCell>
                        {card.success ? (
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                className="h-auto min-h-[32px] w-full min-w-[160px] justify-start text-left text-xs font-medium border-transparent bg-secondary/50 hover:bg-secondary px-3 py-1.5 shadow-none"
                              >
                                {card.category ? (
                                  <div className="flex flex-col items-start gap-1 w-full">
                                    {card.category
                                      .split(', ')
                                      .map((cat, idx) => (
                                        <span
                                          key={idx}
                                          className="bg-background/60 px-1.5 py-0.5 rounded border border-border/30 whitespace-normal break-words text-left"
                                        >
                                          {cat}
                                        </span>
                                      ))}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">
                                    Указать цели...
                                  </span>
                                )}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-56 p-1" align="start">
                              <div className="max-h-[300px] overflow-y-auto space-y-1 p-1">
                                {VISIT_CATEGORIES.map((cat) => {
                                  // Превращаем текущую строку в массив, чтобы понять, выбрана ли категория
                                  const currentCategories = card.category
                                    ? card.category.split(', ')
                                    : [];
                                  const isSelected =
                                    currentCategories.includes(cat);

                                  return (
                                    <div
                                      key={cat}
                                      onClick={() => {
                                        let newCats = [...currentCategories];
                                        if (isSelected) {
                                          newCats = newCats.filter(
                                            (c) => c !== cat,
                                          ); // Убираем
                                        } else {
                                          newCats.push(cat); // Добавляем
                                        }
                                        // Сохраняем обратно как строку
                                        handleCategoryChange(
                                          card.id,
                                          card.visitId,
                                          newCats.join(', '),
                                        );
                                      }}
                                      className="flex items-center space-x-2 rounded-sm px-2 py-1.5 cursor-pointer hover:bg-secondary/80"
                                    >
                                      <div
                                        className={`flex h-4 w-4 items-center justify-center rounded border ${
                                          isSelected
                                            ? 'bg-primary border-primary'
                                            : 'border-primary/50'
                                        }`}
                                      >
                                        {isSelected && (
                                          <Check className="h-3 w-3 text-primary-foreground" />
                                        )}
                                      </div>
                                      <span className="text-xs">{cat}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </PopoverContent>
                          </Popover>
                        ) : (
                          <span className="text-muted-foreground text-sm">
                            -
                          </span>
                        )}
                      </TableCell>

                      <TableCell>
                        {card.success ? (
                          !card.keyIssued ? (
                            <div className="flex gap-2 items-center">
                              <Input
                                placeholder="№"
                                className="w-14 h-9 text-center"
                                value={card.keyNumber}
                                onChange={(e) =>
                                  handleKeyInput(card.id, e.target.value)
                                }
                              />
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-9 text-primary hover:text-primary/80 hover:bg-primary/10 transition-colors px-3"
                                onClick={() =>
                                  handleIssueKey(
                                    card.visitId,
                                    card.keyNumber,
                                    card.id,
                                  )
                                }
                              >
                                Выдать
                              </Button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center px-2.5 py-1.5 rounded-md bg-primary/10 text-primary text-sm font-medium border border-primary/20">
                              Выдан №{card.keyNumber}
                            </div>
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
              Поиск по базе
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
                      setIsRegOpen(true);
                    }}
                  >
                    Создать нового
                  </Button>
                </div>
              ) : (
                searchResults.map((u) => (
                  <Card
                    key={u.id}
                    onClick={() => handleManualVisit(u.id)}
                    className="cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors shadow-none border-dashed"
                  >
                    <CardContent className="p-3 flex justify-between items-center">
                      <div className="font-semibold">{u.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {u.phone}
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* МОДАЛКА: РЕГИСТРАЦИЯ */}
      <Dialog open={isRegOpen} onOpenChange={setIsRegOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary">
              <UserPlus className="w-5 h-5" />
              Регистрация на ресепшене
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRegisterSubmit} className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">
                Фамилия и Имя *
              </label>
              <Input
                required
                placeholder="Иванов Иван"
                value={regForm.name}
                onChange={handleNameInput}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">
                Телефон *
              </label>
              <Input
                required
                type="tel"
                placeholder="+7 (999) 000-00-00"
                value={regForm.phone}
                onChange={handlePhoneInput}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">
                Откуда узнал?
              </label>
              <Input
                placeholder="Например: Проходил мимо"
                value={regForm.source}
                onChange={(e) =>
                  setRegForm({ ...regForm, source: e.target.value })
                }
              />
            </div>

            {regError && (
              <div className="text-sm font-medium text-destructive bg-destructive/10 p-3 rounded-md">
                {regError}
              </div>
            )}

            <Button type="submit" disabled={regLoading} className="w-full mt-2">
              {regLoading ? 'Сохранение...' : 'Зарегистрировать и пропустить'}
            </Button>
          </form>
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
