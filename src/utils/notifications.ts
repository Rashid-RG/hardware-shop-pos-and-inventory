export type NoticeLevel = 'success' | 'error' | 'warning' | 'info';
export type AppNotice = { id: number; level: NoticeLevel; message: string; createdAt: number };
type Listener = (notice: AppNotice) => void;

// In-memory UI messages only: never send financial or customer details to an external service.
const listeners = new Set<Listener>();
let sequence = 0;

export function notify(message: unknown, level: NoticeLevel = 'warning'): void {
  const value = String(message instanceof Error ? message.message : message ?? '').trim();
  if (!value) return;
  const notice: AppNotice = {
    id: ++sequence,
    level,
    message: value.length > 600 ? value.slice(0, 597) + '...' : value,
    createdAt: Date.now(),
  };
  for (const listener of listeners) listener(notice);
}
notify.success = (message: unknown) => notify(message, 'success');
notify.error = (message: unknown) => notify(message, 'error');
notify.warning = (message: unknown) => notify(message, 'warning');
notify.info = (message: unknown) => notify(message, 'info');

export function subscribeNotifications(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
