import { useEffect, useState } from 'react';

import type { TelephonyTranscription } from '@/api/telephony';
import { cn } from '@/lib/utils';

const TRANSCRIPTION_STAGE_LABELS: Record<string, string> = {
  queued: 'Ожидает worker',
  claimed: 'Запуск обработки',
  downloading_audio: 'Скачивание записи',
  ffmpeg_preprocess: 'Подготовка аудио',
  transcribing_admin_channel: 'Речь администратора',
  transcribing_client_channel: 'Речь клиента',
  transcribing_unknown_channel: 'Распознавание записи',
  merging_segments: 'Сборка диалога',
  ai_postprocessing: 'AI-редактура',
  uploading_result: 'Сохранение результата',
};

function isTranscriptionPending(status?: TelephonyTranscription['status']) {
  return status === 'queued' || status === 'processing';
}

interface TranscriptionProgressProps {
  className?: string;
  transcription?: TelephonyTranscription | null;
}

export function TranscriptionProgress({
  className,
  transcription,
}: TranscriptionProgressProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!transcription || !isTranscriptionPending(transcription.status)) {
    return null;
  }

  const progress = transcription.metadata?.progress;
  const percent = Math.min(Math.max(Number(progress?.percent) || 0, 0), 100);
  const updatedAt = progress?.updatedAt
    ? new Date(progress.updatedAt).getTime()
    : 0;
  const stale =
    transcription.status === 'processing' &&
    (!updatedAt || now - updatedAt > 5 * 60 * 1000);
  const stage = progress?.stage || (transcription.status === 'queued' ? 'queued' : 'processing');
  const stageLabel =
    TRANSCRIPTION_STAGE_LABELS[stage] ||
    (transcription.status === 'queued' ? 'Ожидает worker' : 'Обработка');
  const shortLabel = stale
    ? `Статус устарел · ${percent}%`
    : `${stageLabel} · ${percent}%`;
  const compactStageLabel = stale ? 'Статус устарел' : stageLabel;
  const details = stale
    ? `Обработка зависла — нет свежего статуса${progress?.message ? `. ${progress.message}` : ''}`
    : progress?.message || shortLabel;

  return (
    <div
      className={cn(
        'mt-2 w-full min-w-0 max-w-full space-y-1 overflow-hidden',
        className,
      )}
      data-testid="transcription-progress"
      title={details}
    >
      <div className="h-1.5 w-full max-w-full overflow-hidden rounded-full bg-muted-foreground/20">
        <div
          className="h-full max-w-full rounded-full bg-primary transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div
        className={cn(
          'flex min-w-0 max-w-full items-center gap-1 overflow-hidden text-xs',
          stale ? 'text-destructive' : 'text-muted-foreground',
        )}
        data-testid="transcription-progress-label"
      >
        <span
          className="min-w-0 truncate"
          data-testid="transcription-progress-stage"
        >
          {compactStageLabel}
        </span>
        <span className="shrink-0">{' · '}{percent}%</span>
      </div>
    </div>
  );
}
