import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PermissionActionButton } from '@/components/permission-feedback';
import { toast } from '@/components/ui/toast';
import { permissionMessages } from '@/lib/permission-feedback';

vi.mock('@/components/ui/toast', () => ({
  toast: {
    info: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PermissionActionButton', () => {
  it('keeps permission-blocked actions focusable and shows feedback without calling the action', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <PermissionActionButton
        allowed={false}
        deniedMessage={permissionMessages.catalogManage}
        onClick={onClick}
      >
        Сохранить
      </PermissionActionButton>,
    );

    const button = screen.getByRole('button', { name: /сохранить/i });

    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('title', permissionMessages.catalogManage);

    await user.click(button);

    expect(onClick).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith('Недостаточно прав', {
      description: permissionMessages.catalogManage,
    });
  });

  it('calls the action normally when permission is allowed', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <PermissionActionButton
        allowed
        deniedMessage={permissionMessages.catalogManage}
        onClick={onClick}
      >
        Сохранить
      </PermissionActionButton>,
    );

    await user.click(screen.getByRole('button', { name: /сохранить/i }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('uses the action title instead of disabledReason when the allowed action is enabled', () => {
    render(
      <PermissionActionButton
        allowed
        deniedMessage={permissionMessages.catalogManage}
        disabled={false}
        disabledReason="Сначала выберите категорию"
        title="Сохранить правило"
      >
        Сохранить
      </PermissionActionButton>,
    );

    expect(screen.getByRole('button', { name: /сохранить/i })).toHaveAttribute(
      'title',
      'Сохранить правило',
    );
  });

  it('keeps disabledReason as title for allowed native-disabled actions', () => {
    render(
      <PermissionActionButton
        allowed
        deniedMessage={permissionMessages.catalogManage}
        disabled
        disabledReason="Сначала выберите категорию"
        title="Сохранить правило"
      >
        Сохранить
      </PermissionActionButton>,
    );

    const button = screen.getByRole('button', { name: /сохранить/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Сначала выберите категорию');
  });
});
