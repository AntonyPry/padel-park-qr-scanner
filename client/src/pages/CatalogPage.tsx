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
import { AlertCircle, CheckCircle2, Trash2 } from 'lucide-react';
import { API_URL } from '@/config';

const CATEGORIES = [
  'Бар / Кафе',
  'Магазин (Товары)',
  'Прокат инвентаря / VIP',
  'Турниры',
  'Аренда кортов',
];

export default function CatalogPage() {
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'unmapped' | 'rules'>('unmapped');
  const [selections, setSelections] = useState<Record<string, string>>({});

  const fetchData = async () => {
    const [unmappedRes, rulesRes] = await Promise.all([
      fetch(`${API_URL}api/catalog/unmapped`),
      fetch(`${API_URL}api/catalog/rules`),
    ]);
    setUnmapped(await unmappedRes.json());
    setRules(await rulesRes.json());
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSaveRule = async (itemName: string) => {
    const category = selections[itemName];
    if (!category) return;

    await fetch(`${API_URL}api/catalog/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemName, category }),
    });

    // Убираем из нераспознанных и обновляем стейт
    setSelections((prev) => {
      const next = { ...prev };
      delete next[itemName];
      return next;
    });
    fetchData();
  };

  const handleDeleteRule = async (id: number) => {
    await fetch(`${API_URL}api/catalog/rules/${id}`, {
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
            Требуют внимания
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
            Все правила ({rules.length})
          </Button>
        </div>
      </div>

      {activeTab === 'unmapped' ? (
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
                            {CATEGORIES.map((c) => (
                              <SelectItem key={c} value={c}>
                                {c}
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
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Сохраненные правила</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Товар</TableHead>
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
    </div>
  );
}
