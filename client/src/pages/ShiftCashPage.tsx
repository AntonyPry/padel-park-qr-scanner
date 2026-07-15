import { ShiftCashPanel } from '@/components/shift-cash-panel';

export default function ShiftCashPage() {
  return (
    <div className="grid min-w-0 gap-5">
      <header className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">Касса текущей смены</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Начальный остаток, наличная выручка, расходы и кассовая сверка текущей
          смены.
        </p>
      </header>
      <ShiftCashPanel />
    </div>
  );
}
