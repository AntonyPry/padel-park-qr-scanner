import { AdminMotivationSettings } from '@/pages/AdminMotivationPage';
import { ShiftReportTemplatesSettings } from '@/pages/ShiftReportsPage';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function ShiftSettingsPage() {
  return (
    <div className="grid min-w-0 gap-5">
      <header className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">Настройки смены</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Правила мотивации сотрудников и шаблоны обязательных отчетов.
        </p>
      </header>

      <Tabs className="min-w-0" defaultValue="motivation">
        <TabsList className="grid h-auto w-full grid-cols-2">
          <TabsTrigger className="min-h-10 min-w-0 whitespace-normal" value="motivation">
            Правила мотивации
          </TabsTrigger>
          <TabsTrigger className="min-h-10 min-w-0 whitespace-normal" value="reports">
            Шаблоны отчетов
          </TabsTrigger>
        </TabsList>
        <TabsContent className="mt-5 min-w-0" value="motivation">
          <AdminMotivationSettings />
        </TabsContent>
        <TabsContent className="mt-5 min-w-0" value="reports">
          <ShiftReportTemplatesSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
