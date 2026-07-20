import { useEffect, useRef } from 'react';
import { INSTALLATION_OPERATOR_URL } from '@/config';

const REQUIRED_ACTIVATIONS = 10;
const ROLLING_WINDOW_MS = 5_000;
const INACTIVITY_RESET_MS = 1_500;

type OperatorLogoShortcutProps = {
  destination?: string;
  navigate?: (destination: string) => void;
};

export function OperatorLogoShortcut({
  destination = INSTALLATION_OPERATOR_URL,
  navigate = (target) => window.location.assign(target),
}: OperatorLogoShortcutProps) {
  const activations = useRef<number[]>([]);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function resetSequence() {
    activations.current = [];
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = null;
  }

  function activate() {
    const now = Date.now();
    if (resetTimer.current) clearTimeout(resetTimer.current);
    activations.current = activations.current.filter(
      (timestamp) => now - timestamp <= ROLLING_WINDOW_MS,
    );
    activations.current.push(now);

    if (activations.current.length >= REQUIRED_ACTIVATIONS) {
      resetSequence();
      navigate(destination);
      return;
    }

    resetTimer.current = setTimeout(resetSequence, INACTIVITY_RESET_MS);
  }

  useEffect(() => resetSequence, []);

  return (
    <button
      aria-label="Setly"
      className="mb-2 flex items-center gap-3 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      onClick={activate}
      type="button"
    >
      <img
        src="/setly-mark.png?v=20260714"
        alt=""
        className="size-11 rounded-xl border border-border object-cover shadow-sm"
      />
      <span className="text-base font-semibold text-foreground">Setly</span>
    </button>
  );
}
