import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  AlertCircle,
  CheckCircle2,
  Trash2,
  Plus,
  Tag,
  Percent,
  AlertTriangle,
} from 'lucide-react';
import { API_URL } from '@/config';

const PNL_GROUPS = [
  { value: 'REVENUE_POS', label: 'Касса (Эвотор)', type: 'income' },
  { value: 'REVENUE_EXT', label: 'Выручка вне кассы', type: 'income' },
  { value: 'COGS', label: 'Себестоимость (Закупы)', type: 'expense' },
  { value: 'FEES', label: 'Комиссии и Эквайринг', type: 'expense' },
  { value: 'OPEX', label: 'Операционные расходы (OPEX)', type: 'expense' },
];

export default function CatalogPage() {
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [newCatParentId, setNewCatParentId] = useState<string>('none');

  const [activeTab, setActiveTab] = useState<
    'unmapped' | 'rules' | 'categories'
  >('unmapped');
  const [selections, setSelections] = useState<Record<string, string>>({});

  const [newCatName, setNewCatName] = useState('');
  const [newCatGroup, setNewCatGroup] = useState('OPEX');
  const [newCatPercent, setNewCatPercent] = useState('');

  // СТЕЙТ ДЛЯ МОДАЛКИ ПОДТВЕРЖДЕНИЯ УДАЛЕНИЯ
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const fetchData = async () => {
    try {
      const [unmappedRes, rulesRes, catRes] = await Promise.all([
        fetch(`${API_URL}/api/catalog/unmapped`),
        fetch(`${API_URL}/api/catalog/rules`),
        fetch(`${API_URL}/api/catalog/categories`),
      ]);
      setUnmapped(await unmappedRes.json());
      setRules(await rulesRes.json());
      setCategories(await catRes.json());
    } catch (e) {
      console.error('Fetch error:', e);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSaveRule = async (itemName: string) => {
    const category = selections[itemName];
    if (!category) return;

    await fetch(`${API_URL}/api/catalog/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemName, category }),
    });

    setSelections((prev) => {
      const next = { ...prev };
      delete next[itemName];
      return next;
    });
    fetchData();
  };

  const handleDeleteRule = async (id: number) => {
    await fetch(`${API_URL}/api/catalog/rules/${id}`, { method: 'DELETE' });
    fetchData();
  };

  const handleParentChange = (val: string) => {
    setNewCatParentId(val);
    if (val !== 'none') {
      const parentCat = categories.find((c) => String(c.id) === val);
      if (parentCat) setNewCatGroup(parentCat.group);
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;

    const selectedGroupDef = PNL_GROUPS.find((g) => g.value === newCatGroup);
    const type = selectedGroupDef ? selectedGroupDef.type : 'expense';

    await fetch(`${API_URL}/api/catalog/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newCatName.trim(),
        type: type,
        group: newCatGroup,
        commissionPercent: newCatPercent ? Number(newCatPercent) : 0,
        parentId: newCatParentId === 'none' ? null : Number(newCatParentId),
      }),
    });

    setNewCatName('');
    setNewCatPercent('');
    setNewCatGroup('OPEX');
    setNewCatParentId('none');
    fetchData();
  };

  // ФАКТИЧЕСКОЕ УДАЛЕНИЕ (ВЫЗЫВАЕТСЯ ИЗ МОДАЛКИ)
  const confirmDeleteCategory = async () => {
    if (!deleteConfirmId) return;

    await fetch(`${API_URL}/api/catalog/categories/${deleteConfirmId}`, {
      method: 'DELETE',
    });

    setDeleteConfirmId(null);
    fetchData();
  };

  const getGroupLabel = (groupVal: string) => {
    return PNL_GROUPS.find((g) => g.value === groupVal)?.label || groupVal;
  };

  // ФУНКЦИЯ ДЛЯ ОБНОВЛЕНИЯ РОДИТЕЛЯ ИЗ ТАБЛИЦЫ
  const handleUpdateParent = async (
    categoryId: number,
    newParentId: string,
  ) => {
    try {
      const res = await fetch(
        `${API_URL}/api/catalog/categories/${categoryId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            parentId: newParentId === 'none' ? null : Number(newParentId),
          }),
        },
      );
      if (res.ok) fetchData();
    } catch (e) {
      console.error('Update error:', e);
    }
  };

  // ФУНКЦИИ ЗАЩИТЫ ОТ ЦИКЛОВ НА КЛИЕНТЕ
  // Проверяет, является ли potentialChild потомком категории categoryId
  const isDescendant = (potentialChildId: number, categoryId: number) => {
    let current = categories.find((c) => c.id === potentialChildId);
    while (current) {
      if (current.parentId === categoryId) return true;
      current = categories.find((c) => c.id === current.parentId);
    }
    return false;
  };

  // Получает список доступных родителей (исключая саму себя и всех своих потомков)
  const getAvailableParents = (catId: number) => {
    return categories.filter(
      (c) => c.id !== catId && !isDescendant(c.id, catId),
    );
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Справочник товаров
          </h1>
          <p className="text-muted-foreground mt-1">
            Распределение номенклатуры Эвотор по категориям P&L
          </p>
        </div>
        <div className="flex bg-muted p-1 rounded-md">
          <Button
            variant={activeTab === 'unmapped' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('unmapped')}
          >
            Неразобранные
            {unmapped.length > 0 && (
              <span className="ml-2 bg-destructive text-white text-xs px-2 py-0.5 rounded-full">
                {unmapped.length}
              </span>
            )}
          </Button>
          <Button
            variant={activeTab === 'rules' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('rules')}
          >
            Правила ({rules.length})
          </Button>
          <Button
            variant={activeTab === 'categories' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('categories')}
          >
            Категории ({categories.length})
          </Button>
        </div>
      </div>

      {/* Модальное окно подтверждения удаления */}
      <Dialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => !open && setDeleteConfirmId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" /> Внимание
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Вы уверены, что хотите удалить эту категорию?
            </p>
            <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
              <li>
                Если у категории есть подкатегории, они также будут удалены.
              </li>
              <li>
                Все товары из чеков, привязанные к этим категориям, вернутся во
                вкладку «Неразобранные».
              </li>
            </ul>
            <div className="flex justify-end gap-3 pt-4">
              <Button
                variant="outline"
                onClick={() => setDeleteConfirmId(null)}
              >
                Отмена
              </Button>
              <Button variant="destructive" onClick={confirmDeleteCategory}>
                Удалить категорию
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ОСТАЛЬНАЯ ЧАСТЬ ИНТЕРФЕЙСА */}
      {activeTab === 'unmapped' && (
        <Card
          className={
            unmapped.length === 0
              ? 'bg-green-500/5 border-green-500/20'
              : 'border-orange-500/20'
          }
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {unmapped.length === 0 ? (
                <CheckCircle2 className="text-green-500" />
              ) : (
                <AlertCircle className="text-orange-500" />
              )}
              {unmapped.length === 0
                ? 'Все товары распределены'
                : 'Найдены новые товары в чеках'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {unmapped.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Название в кассе Эвотор</TableHead>
                    <TableHead>Категория P&L</TableHead>
                    <TableHead className="w-[100px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unmapped.map((itemName) => (
                    <TableRow key={itemName}>
                      <TableCell className="font-medium">{itemName}</TableCell>
                      <TableCell>
                        <Select
                          onValueChange={(val) =>
                            setSelections({ ...selections, [itemName]: val })
                          }
                        >
                          <SelectTrigger className="w-[250px]">
                            <SelectValue placeholder="Выберите категорию..." />
                          </SelectTrigger>
                          <SelectContent>
                            {categories.map((c) => (
                              <SelectItem key={c.id} value={c.name}>
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          disabled={!selections[itemName]}
                          onClick={() => handleSaveRule(itemName)}
                        >
                          Сохранить
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'rules' && (
        <Card>
          <CardHeader>
            <CardTitle>Сохраненные правила</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Товар из Эвотора</TableHead>
                  <TableHead>Категория</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium">
                      {rule.itemName}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {rule.category}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteRule(rule.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {activeTab === 'categories' && (
        <Card>
          <CardHeader>
            <CardTitle>Управление категориями P&L</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <form
              onSubmit={handleAddCategory}
              className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end bg-muted/30 p-4 rounded-lg border"
            >
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Название категории
                </label>
                <Input
                  placeholder="Например: Лунда"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Группа в отчете</label>
                <Select
                  value={newCatGroup}
                  onValueChange={setNewCatGroup}
                  disabled={newCatParentId !== 'none'}
                >
                  <SelectTrigger
                    className={newCatParentId !== 'none' ? 'bg-muted' : ''}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PNL_GROUPS.map((g) => (
                      <SelectItem key={g.value} value={g.value}>
                        {g.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {newCatParentId !== 'none' && (
                  <p className="text-[10px] text-muted-foreground absolute mt-0.5">
                    Наследуется от родителя
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Авто-комиссия (%)</label>
                <div className="relative">
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    placeholder="0"
                    value={newCatPercent}
                    onChange={(e) => setNewCatPercent(e.target.value)}
                  />
                  <Percent className="w-4 h-4 text-muted-foreground absolute right-3 top-3" />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Родитель</label>
                <Select
                  value={newCatParentId}
                  onValueChange={handleParentChange}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Нет (Корневая)</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full">
                <Plus className="w-4 h-4 mr-2" /> Добавить
              </Button>
            </form>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Название</TableHead>
                    <TableHead>Группа отчета</TableHead>
                    <TableHead>Авто-комиссия</TableHead>
                    <TableHead>Родитель</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.map((cat) => (
                    <TableRow key={cat.id}>
                      <TableCell className="font-medium flex items-center gap-2">
                        <Tag className="w-4 h-4 text-muted-foreground" />{' '}
                        {cat.name}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {getGroupLabel(cat.group)}
                      </TableCell>
                      <TableCell>
                        {Number(cat.commissionPercent) > 0 ? (
                          <span className="bg-destructive/10 text-destructive px-2 py-1 rounded-md text-sm font-medium">
                            {cat.commissionPercent}%
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      {/* ЖИВОЙ ВЫБОР РОДИТЕЛЯ ПРЯМО В ТАБЛИЦЕ */}
                      <TableCell>
                        <Select
                          value={cat.parentId ? String(cat.parentId) : 'none'}
                          onValueChange={(val) =>
                            handleUpdateParent(cat.id, val)
                          }
                        >
                          <SelectTrigger className="w-[180px] bg-transparent border-dashed">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem
                              value="none"
                              className="text-muted-foreground"
                            >
                              Нет (Корневая)
                            </SelectItem>
                            {getAvailableParents(cat.id).map((c) => (
                              <SelectItem key={c.id} value={String(c.id)}>
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {!cat.isSystem && (
                          // ВЫЗЫВАЕМ МОДАЛКУ ВМЕСТО ПРЯМОГО УДАЛЕНИЯ
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteConfirmId(cat.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {categories.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-center py-6 text-muted-foreground"
                      >
                        Нет созданных категорий
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
