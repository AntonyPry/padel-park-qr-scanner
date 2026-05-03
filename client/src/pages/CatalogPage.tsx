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
import { Input } from '@/components/ui/input';
import { AlertCircle, CheckCircle2, Trash2, Plus, Tag } from 'lucide-react';
import { API_URL } from '@/config';

export default function CatalogPage() {
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);

  const [activeTab, setActiveTab] = useState<
    'unmapped' | 'rules' | 'categories'
  >('unmapped');
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [newCatName, setNewCatName] = useState('');

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

  // --- УПРАВЛЕНИЕ ПРАВИЛАМИ МАППИНГА ---
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

  // --- УПРАВЛЕНИЕ КАТЕГОРИЯМИ ---
  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;

    await fetch(`${API_URL}/api/catalog/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newCatName.trim(), type: 'income' }), // По умолчанию income
    });
    setNewCatName('');
    fetchData();
  };

  const handleDeleteCategory = async (id: number) => {
    await fetch(`${API_URL}/api/catalog/categories/${id}`, {
      method: 'DELETE',
    });
    fetchData();
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
            <CardTitle>Управление категориями</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <form onSubmit={handleAddCategory} className="flex gap-4 items-end">
              <div className="flex-1 space-y-2">
                <label className="text-sm font-medium">Новая категория</label>
                <Input
                  placeholder="Например: Спонсорские деньги"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                />
              </div>
              <Button type="submit">
                <Plus className="w-4 h-4 mr-2" /> Добавить
              </Button>
            </form>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Название категории</TableHead>
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
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteCategory(cat.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {categories.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={2}
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
