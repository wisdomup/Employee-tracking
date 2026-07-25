import React, { useEffect, useMemo, useState } from 'react';
import {
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isToday,
  format,
} from 'date-fns';
import { visitService, Visit } from '../../services/visitService';
import styles from '../../styles/VisitsCalendar.module.scss';

interface VisitsMonthCalendarProps {
  /** Optional employee filter — narrows the calendar to one employee's schedule. */
  employeeId?: string;
  onDayClick: (day: Date, dayVisits: Visit[]) => void;
  /** Bump to force a refetch of the visible month (e.g. after assigning new visits). */
  refreshKey?: number;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const VisitsMonthCalendar: React.FC<VisitsMonthCalendarProps> = ({ employeeId, onDayClick, refreshKey }) => {
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);

  const monthStart = startOfMonth(monthCursor);
  const monthEnd = endOfMonth(monthCursor);
  const gridStart = startOfWeek(monthStart);
  const gridEnd = endOfWeek(monthEnd);
  const days = useMemo(() => eachDayOfInterval({ start: gridStart, end: gridEnd }), [gridStart, gridEnd]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    visitService
      .getVisits({
        employeeId: employeeId || undefined,
        startDate: format(monthStart, 'yyyy-MM-dd'),
        endDate: format(monthEnd, 'yyyy-MM-dd'),
      })
      .then((data) => {
        if (!cancelled) setVisits(data);
      })
      .catch(() => {
        if (!cancelled) setVisits([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthStart.getTime(), monthEnd.getTime(), employeeId, refreshKey]);

  const visitsByDay = useMemo(() => {
    const map = new Map<string, Visit[]>();
    for (const visit of visits) {
      if (!visit.visitDate) continue;
      const key = format(new Date(visit.visitDate), 'yyyy-MM-dd');
      const list = map.get(key) ?? [];
      list.push(visit);
      map.set(key, list);
    }
    return map;
  }, [visits]);

  return (
    <div className={styles.calendarCard}>
      <div className={styles.calendarHeader}>
        <button type="button" className={styles.navButton} onClick={() => setMonthCursor((m) => subMonths(m, 1))}>
          ‹
        </button>
        <h2>{format(monthCursor, 'MMMM yyyy')}</h2>
        <button type="button" className={styles.navButton} onClick={() => setMonthCursor((m) => addMonths(m, 1))}>
          ›
        </button>
        <button type="button" className={styles.todayButton} onClick={() => setMonthCursor(startOfMonth(new Date()))}>
          Today
        </button>
      </div>

      <div className={styles.weekdayRow}>
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className={styles.weekdayCell}>
            {label}
          </div>
        ))}
      </div>

      <div className={styles.monthGrid}>
        {days.map((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const dayVisits = visitsByDay.get(key) ?? [];
          const outsideMonth = !isSameMonth(day, monthCursor);
          return (
            <button
              type="button"
              key={key}
              className={`${styles.dayCell} ${outsideMonth ? styles.dayCellOutside : ''} ${
                isToday(day) ? styles.dayCellToday : ''
              }`}
              onClick={() => onDayClick(day, dayVisits)}
            >
              <span className={styles.dayNumber}>{format(day, 'd')}</span>
              {dayVisits.length > 0 && <span className={styles.dayBadge}>{dayVisits.length}</span>}
            </button>
          );
        })}
      </div>
      {loading && <p className={styles.loadingHint}>Loading visits…</p>}
    </div>
  );
};

export default VisitsMonthCalendar;
