import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { TelephonyTranscription } from '@/api/telephony';
import { TranscriptionProgress } from '@/components/transcription-progress';

function transcriptionFixture(
  overrides: Partial<TelephonyTranscription> = {},
): TelephonyTranscription {
  return {
    attemptCount: 1,
    id: 7,
    status: 'queued',
    telephonyCallId: 11,
    ...overrides,
  };
}

afterEach(() => cleanup());

describe('TranscriptionProgress', () => {
  it('contains a long message and renders only a short stage with 100%', () => {
    const longMessage =
      'Очень длинный служебный комментарий о распознавании записи, который не должен расширять колонку таблицы или мобильную карточку';
    render(
      <TranscriptionProgress
        transcription={transcriptionFixture({
          metadata: {
            progress: {
              message: longMessage,
              percent: 100,
              stage: 'unknown_custom_stage',
              updatedAt: new Date().toISOString(),
            },
          },
        })}
      />,
    );

    const progress = screen.getByTestId('transcription-progress');
    const label = screen.getByTestId('transcription-progress-label');
    const stage = screen.getByTestId('transcription-progress-stage');
    expect(progress).toHaveClass('min-w-0', 'max-w-full', 'overflow-hidden');
    expect(label).toHaveClass('min-w-0', 'max-w-full', 'overflow-hidden');
    expect(stage).toHaveClass('min-w-0', 'truncate');
    expect(label.querySelector('.shrink-0')).toHaveTextContent('· 100%');
    expect(label).toHaveTextContent('Ожидает worker · 100%');
    expect(label).not.toHaveTextContent(longMessage);
    expect(progress).toHaveAttribute('title', longMessage);
  });

  it('keeps stale processing compact and preserves details in the title', () => {
    render(
      <TranscriptionProgress
        transcription={transcriptionFixture({
          status: 'processing',
          metadata: {
            progress: {
              message: 'Давно не было heartbeat от worker',
              percent: 64,
              stage: 'transcribing_client_channel',
              updatedAt: '2020-01-01T00:00:00.000Z',
            },
          },
        })}
      />,
    );

    expect(screen.getByTestId('transcription-progress-label')).toHaveTextContent(
      'Статус устарел · 64%',
    );
    expect(screen.getByTestId('transcription-progress')).toHaveAttribute(
      'title',
      expect.stringContaining('Обработка зависла'),
    );
  });

  it('renders queued jobs without progress metadata safely', () => {
    render(<TranscriptionProgress transcription={transcriptionFixture()} />);

    expect(screen.getByTestId('transcription-progress-label')).toHaveTextContent(
      'Ожидает worker · 0%',
    );
  });
});
