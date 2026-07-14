export interface PendingScannerScan {
  attempts: number;
  clientEventId: string;
  createdAt: number;
  qrCode: string;
}

export function createPendingScannerScan(
  qrCode: string,
  createClientEventId: () => string,
  now = Date.now,
): PendingScannerScan {
  return {
    attempts: 0,
    clientEventId: createClientEventId(),
    createdAt: now(),
    qrCode,
  };
}

export function recordPendingScannerRetry(scan: PendingScannerScan) {
  scan.attempts += 1;
  return scan;
}
