import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { format, subDays } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { ArrowUpDown, Calendar as CalendarIcon, Download, Info } from 'lucide-react';
import { getSourceQuality, type RateMetric, type SourceQualityRow } from '@/api/visits-analytics';
import { queryKeys } from '@/api/query-keys';
import { apiFetch, getApiErrorMessage, readApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorState } from '@/components/error-state';
import { ChartLoadingState } from '@/components/chart-loading-state';
import { toast } from '@/components/ui/toast';

type SortKey = 'source'|'newClients'|'oneVisit30'|'repeat30'|'repeat60'|'repeat90'|'threePlus90'|'averageVisits90'|'medianDaysToSecondVisit'|'sampleSize';
const columns: Array<{key:SortKey; label:string; title:string}> = [
  {key:'source',label:'Источник',title:'Источник канонического клиента: справочник, затем legacy-значение'},
  {key:'newClients',label:'Новых клиентов',title:'Первый валидный lifetime-визит попал в выбранный период'},
  {key:'oneVisit30',label:'Один визит за 30 дней',title:'Клиенты без второго визита за 30 дней / eligible30'},
  {key:'repeat30',label:'Вернулись за 30 дней',title:'Второй визит не позднее 30 дней / eligible30'},
  {key:'repeat60',label:'Вернулись за 60 дней',title:'Второй визит не позднее 60 дней / eligible60'},
  {key:'repeat90',label:'Вернулись за 90 дней',title:'Второй визит не позднее 90 дней / eligible90'},
  {key:'threePlus90',label:'3+ визита за 90 дней',title:'Не менее трёх визитов в первые 90 дней / eligible90'},
  {key:'averageVisits90',label:'Среднее визитов за 90 дней',title:'Все визиты первых 90 дней / eligible90'},
  {key:'medianDaysToSecondVisit',label:'Медиана дней до второго',title:'Медиана среди клиентов, совершивших второй визит'},
  {key:'sampleSize',label:'Размер выборки',title:'Созревшие когорты eligible30 / eligible60 / eligible90'},
];
function rate(metric: RateMetric) {
  if (metric.rate === null) return <span title="Недостаточно времени">— <small className="block text-muted-foreground">Недостаточно времени</small></span>;
  return <span>{metric.rate.toFixed(1)}% <small className="block text-muted-foreground">{metric.count} из {metric.eligibleCount}</small></span>;
}
function value(row:SourceQualityRow,key:SortKey): string|number {
  if (key==='source') return row.source.toLocaleLowerCase('ru');
  if (key==='newClients') return row.newClients;
  if (key==='sampleSize') return row.sampleSize.eligible90;
  const item=row[key]; return item && typeof item==='object' && 'rate' in item ? item.rate ?? -1 : typeof item === 'number' ? item : -1;
}
function Metric({row,k}:{row:SourceQualityRow;k:SortKey}) {
  if (['oneVisit30','repeat30','repeat60','repeat90','threePlus90'].includes(k)) return rate(row[k as keyof SourceQualityRow] as RateMetric);
  if(k==='averageVisits90') return row.averageVisits90===null?'—':row.averageVisits90.toFixed(2);
  if(k==='medianDaysToSecondVisit') return row.medianDaysToSecondVisit===null?'—':row.medianDaysToSecondVisit.toFixed(1);
  if(k==='sampleSize') return <span>{row.sampleSize.eligible30} / {row.sampleSize.eligible60} / {row.sampleSize.eligible90}</span>;
  return <>{String(row[k as 'source'|'newClients'])}</>;
}
export function SourceQualityTab() {
  const [range,setRange]=useState<DateRange>({from:subDays(new Date(),180),to:new Date()});
  const [sort,setSort]=useState<{key:SortKey;desc:boolean}>({key:'newClients',desc:true});
  const [hidden,setHidden]=useState<string[]>([]);
  const params={from:format(range.from!,'yyyy-MM-dd'),to:format(range.to||range.from!,'yyyy-MM-dd')};
  const query=useQuery({queryKey:queryKeys.visitsAnalytics.sourceQuality(params),queryFn:()=>getSourceQuality(params),placeholderData:keepPreviousData});
  const rows=useMemo(()=>[...(query.data?.sources||[])].filter(r=>!hidden.includes(r.source)).sort((a,b)=>{const av=value(a,sort.key),bv=value(b,sort.key);return (typeof av==='string'?av.localeCompare(String(bv),'ru'):Number(av)-Number(bv))*(sort.desc?-1:1)}),[query.data,hidden,sort]);
  async function exportExcel(){const response=await apiFetch(`/api/export/visits/source-quality?from=${params.from}&to=${params.to}`);if(!response.ok){toast.error((await readApiError(response,'Не удалось выгрузить')).message);return}const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download=`source-quality-${params.from}-${params.to}.xlsx`;a.click();URL.revokeObjectURL(url)}
  return <div className="space-y-4">
    <div className="flex flex-col gap-3 rounded-xl border bg-card/60 p-3 sm:flex-row sm:items-end sm:justify-between">
      <div><div className="mb-1 text-sm font-medium">Период первого визита</div><Popover><PopoverTrigger asChild><Button variant="outline"><CalendarIcon className="mr-2 h-4 w-4"/>{format(range.from!,'dd.MM.yyyy')} — {format(range.to||range.from!,'dd.MM.yyyy')}</Button></PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="range" selected={range} onSelect={r=>r?.from&&setRange(r)} defaultMonth={range.from}/></PopoverContent></Popover></div>
      <Button onClick={()=>void exportExcel()} className="bg-green-600 text-white hover:bg-green-700"><Download className="mr-2 h-4 w-4"/>Экспорт качества</Button>
    </div>
    {!!query.data?.sources.length&&<div className="flex flex-wrap gap-2" aria-label="Фильтр по источникам">{query.data.sources.map(r=><Button key={r.source} size="sm" variant={hidden.includes(r.source)?'outline':'secondary'} onClick={()=>setHidden(x=>x.includes(r.source)?x.filter(v=>v!==r.source):[...x,r.source])}>{r.source}</Button>)}</div>}
    {query.isError&&!query.data?<ErrorState title="Качество источников не загрузилось" message={getApiErrorMessage(query.error, 'Не удалось загрузить данные')} onRetry={()=>void query.refetch()}/>:!query.data?<ChartLoadingState title="Загрузка качества источников"/>:rows.length===0?<Card><CardContent className="py-12 text-center text-muted-foreground">Нет новых клиентов за выбранный период</CardContent></Card>:<>
      <div className="hidden overflow-hidden rounded-xl border lg:block"><Table><TableHeader><TableRow>{columns.map(c=><TableHead key={c.key} className="align-top"><Button variant="ghost" className="h-auto max-w-[150px] whitespace-normal px-1 text-left" title={c.title} onClick={()=>setSort(s=>({key:c.key,desc:s.key===c.key?!s.desc:true}))}>{c.label}<Info className="ml-1 h-3 w-3 shrink-0"/><ArrowUpDown className="ml-1 h-3 w-3 shrink-0"/></Button></TableHead>)}</TableRow></TableHeader><TableBody>{rows.map(r=><TableRow key={`${r.sourceId}-${r.source}`}><TableCell className="max-w-[180px] break-words font-medium">{r.source}{r.lowSample&&<small className="block text-amber-600">Мало данных</small>}</TableCell>{columns.slice(1).map(c=><TableCell key={c.key}><Metric row={r} k={c.key}/></TableCell>)}</TableRow>)}</TableBody></Table></div>
      <div className="grid gap-3 lg:hidden">{rows.map(r=><Card key={`${r.sourceId}-${r.source}`} className="min-w-0"><CardHeader><CardTitle className="break-words text-base">{r.source}</CardTitle>{r.lowSample&&<span className="text-xs text-amber-600">Мало данных</span>}</CardHeader><CardContent className="grid grid-cols-2 gap-3 text-sm">{columns.slice(1).map(c=><div key={c.key} className={cn('min-w-0',c.key==='sampleSize'&&'col-span-2')} title={c.title}><div className="text-xs text-muted-foreground">{c.label}</div><div className="mt-1 font-medium"><Metric row={r} k={c.key}/></div></div>)}</CardContent></Card>)}</div>
    </>}
  </div>;
}
