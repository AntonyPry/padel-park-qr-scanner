import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface ConfirmAction {
  confirmLabel: string;
  description: string;
  isDestructive?: boolean;
  title: string;
}

interface ConfirmActionDialogProps {
  action: ConfirmAction | null;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmActionDialog({
  action,
  loading = false,
  onCancel,
  onConfirm,
}: ConfirmActionDialogProps) {
  return (
    <Dialog
      open={Boolean(action)}
      onOpenChange={(open) => {
        if (!open && !loading) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{action?.title || 'Подтвердить действие?'}</DialogTitle>
          <DialogDescription>{action?.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
            Отмена
          </Button>
          <Button
            type="button"
            variant={action?.isDestructive ? 'destructive' : 'default'}
            onClick={() => void onConfirm()}
            disabled={loading}
          >
            {loading ? 'Выполняем...' : action?.confirmLabel || 'Подтвердить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
