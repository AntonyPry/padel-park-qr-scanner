import { useState } from 'react';
import { Pencil } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface VisitKeyControlProps {
  isSaving?: boolean;
  keyNumber: string;
  onSave: (keyNumber: string) => Promise<void>;
}

export function VisitKeyControl({
  isSaving = false,
  keyNumber,
  onSave,
}: VisitKeyControlProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(keyNumber);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const saving = isSaving || isSubmitting;
  const canSave = Boolean(draft) && draft !== keyNumber && !saving;

  const startEditing = () => {
    setDraft(keyNumber);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    if (saving) return;
    setDraft(keyNumber);
    setIsEditing(false);
  };

  const save = async () => {
    if (!canSave) return;
    setIsSubmitting(true);
    try {
      await onSave(draft);
      setIsEditing(false);
    } catch {
      // The caller owns user-facing error feedback. Keep the draft open for retry.
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isEditing) {
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="visit-key-control">
        <Badge variant="secondary">Выдан №{keyNumber}</Badge>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={startEditing}
          aria-label="Изменить номер ключа"
        >
          <Pencil className="h-3.5 w-3.5" />
          Изменить
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="visit-key-control">
      <div className="text-xs text-muted-foreground">
        Текущий номер: №{keyNumber}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          autoFocus
          aria-label="Новый номер ключа"
          inputMode="numeric"
          maxLength={32}
          value={draft}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value.replace(/\D/g, ''))}
        />
        <div className="flex gap-2">
          <Button type="button" disabled={!canSave} onClick={() => void save()}>
            {saving ? 'Сохраняем...' : 'Сохранить'}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={cancelEditing}
          >
            Отмена
          </Button>
        </div>
      </div>
    </div>
  );
}
