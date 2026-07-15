export interface CompletedShiftReport {
  createdAt: string;
  shiftId: number;
  text: string;
}

const STORAGE_KEY = 'setly:last-completed-shift-report';

export function loadCompletedShiftReport() {
  try {
    const value = window.sessionStorage.getItem(STORAGE_KEY);
    if (!value) return null;
    const report = JSON.parse(value) as Partial<CompletedShiftReport>;
    if (!report.text || !Number.isInteger(report.shiftId)) return null;
    return report as CompletedShiftReport;
  } catch {
    return null;
  }
}

export function saveCompletedShiftReport(report: CompletedShiftReport) {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(report));
}
