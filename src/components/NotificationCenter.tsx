import React, { useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { AppNotice, subscribeNotifications } from '../utils/notifications';

const theme = {
  success: { icon: CheckCircle2, heading: 'Completed', box: 'border-emerald-200 bg-emerald-50 text-emerald-900', accent: 'text-emerald-700' },
  error: { icon: AlertCircle, heading: 'Action unsuccessful', box: 'border-rose-200 bg-rose-50 text-rose-900', accent: 'text-rose-700' },
  warning: { icon: AlertTriangle, heading: 'Attention required', box: 'border-amber-200 bg-amber-50 text-amber-950', accent: 'text-amber-700' },
  info: { icon: Info, heading: 'Information', box: 'border-sky-200 bg-sky-50 text-sky-900', accent: 'text-sky-700' },
} as const;

export default function NotificationCenter() {
  const [notices, setNotices] = useState<AppNotice[]>([]);
  useEffect(() => subscribeNotifications(notice => {
    setNotices(current => [...current.filter(item =>
      item.message !== notice.message || item.level !== notice.level
    ), notice].slice(-4));
  }), []);
  useEffect(() => {
    // Errors remain until acknowledged; non-errors dismiss automatically.
    const timers = notices.filter(notice => notice.level !== 'error').map(notice =>
      window.setTimeout(() => setNotices(current => current.filter(item => item.id !== notice.id)),
        notice.level === 'success' ? 5500 : 9000)
    );
    return () => { timers.forEach(window.clearTimeout); };
  }, [notices]);

  return (
    <aside aria-label="Application notifications"
      className="pointer-events-none fixed right-3 top-3 z-[110] flex w-[min(420px,calc(100vw-24px))] flex-col gap-2 sm:right-5 sm:top-5">
      {notices.map(notice => {
        const style = theme[notice.level];
        const Icon = style.icon;
        return (
          <div key={notice.id} role={notice.level === 'error' ? 'alert' : 'status'}
            aria-live={notice.level === 'error' ? 'assertive' : 'polite'}
            className={`pointer-events-auto rounded-xl border p-3 shadow-xl ring-1 ring-black/5 ${style.box}`}>
            <div className="flex items-start gap-2.5">
              <Icon aria-hidden className={`mt-0.5 h-4 w-4 shrink-0 ${style.accent}`}/>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold">{style.heading}</p>
                <p className="mt-0.5 break-words text-xs leading-relaxed">{notice.message}</p>
              </div>
              <button type="button" aria-label={`Dismiss ${notice.level} notification`}
                onClick={() => setNotices(current => current.filter(item => item.id !== notice.id))}
                className="rounded-lg p-1 hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
                <X className="h-4 w-4"/>
              </button>
            </div>
          </div>
        );
      })}
    </aside>
  );
}
