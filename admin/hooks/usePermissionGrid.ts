import { useCallback, useEffect, useState } from 'react';
import type { ActionId, Catalogue, ModuleGrant } from '../services/permissionService';

/**
 * The editable state behind a permission grid: what is ticked, what changed, and the toggle
 * rules for a cell, a row, a column, a report and a whole report surface.
 *
 * Shared by the role/profile matrix and the per-user editor. The toggles look trivial one at a
 * time, but "tick every action in this row unless they are all already on" is the kind of rule
 * that quietly diverges between two copies — and a divergence here means an admin's click does
 * something different depending on which screen they are standing on.
 */
export interface PermissionGrid {
  grants: Record<string, ModuleGrant>;
  reports: Set<string>;
  dirty: boolean;
  /** Replace the whole grid, e.g. after loading or discarding. Clears `dirty`. */
  reset: (permissions: string[], reports: string[]) => void;
  toggle: (moduleId: string, action: ActionId) => void;
  toggleRow: (moduleId: string, actions: ActionId[]) => void;
  toggleColumn: (action: ActionId) => void;
  toggleReport: (reportId: string) => void;
  toggleSurface: (surface: string) => void;
  /** Flat `module:action` list, filtered to cells the catalogue actually supports. */
  toPermissions: () => string[];
  /** Report ids, filtered to ones the catalogue still knows about. */
  toReports: () => string[];
  markClean: () => void;
}

/** Expand a flat `module:action` list into the nested shape the grid renders from. */
function toGrants(permissions: string[]): Record<string, ModuleGrant> {
  const grants: Record<string, ModuleGrant> = {};
  for (const key of permissions) {
    const idx = key.indexOf(':');
    if (idx < 1) continue;
    const moduleId = key.slice(0, idx);
    const action = key.slice(idx + 1) as ActionId;
    grants[moduleId] = { ...(grants[moduleId] ?? {}), [action]: true };
  }
  return grants;
}

export function usePermissionGrid(catalogue: Catalogue | null): PermissionGrid {
  const [grants, setGrants] = useState<Record<string, ModuleGrant>>({});
  const [reports, setReports] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);

  const reset = useCallback((permissions: string[], reportIds: string[]) => {
    setGrants(toGrants(permissions));
    setReports(new Set(reportIds));
    setDirty(false);
  }, []);

  const toggle = useCallback((moduleId: string, action: ActionId) => {
    setGrants((prev) => {
      const grant = { ...(prev[moduleId] ?? {}) };
      grant[action] = !grant[action];
      return { ...prev, [moduleId]: grant };
    });
    setDirty(true);
  }, []);

  /** Tick every action the module supports, or clear them all if they are already on. */
  const toggleRow = useCallback((moduleId: string, actions: ActionId[]) => {
    setGrants((prev) => {
      const grant = prev[moduleId] ?? {};
      const allOn = actions.every((a) => grant[a]);
      const next: ModuleGrant = {};
      for (const a of actions) next[a] = !allOn;
      return { ...prev, [moduleId]: next };
    });
    setDirty(true);
  }, []);

  /** Tick one action down every module that supports it. Modules that do not are untouched. */
  const toggleColumn = useCallback(
    (action: ActionId) => {
      if (!catalogue) return;
      const applicable = catalogue.modules.filter((m) => m.actions.includes(action));

      setGrants((prev) => {
        const allOn = applicable.every((m) => prev[m.id]?.[action]);
        const next = { ...prev };
        for (const m of applicable) {
          next[m.id] = { ...(next[m.id] ?? {}), [action]: !allOn };
        }
        return next;
      });
      setDirty(true);
    },
    [catalogue],
  );

  const toggleReport = useCallback((reportId: string) => {
    setReports((prev) => {
      const next = new Set(prev);
      if (next.has(reportId)) next.delete(reportId);
      else next.add(reportId);
      return next;
    });
    setDirty(true);
  }, []);

  const toggleSurface = useCallback(
    (surface: string) => {
      if (!catalogue) return;
      const ids = catalogue.reports.filter((r) => r.surface === surface).map((r) => r.id);

      setReports((prev) => {
        const allOn = ids.every((id) => prev.has(id));
        const next = new Set(prev);
        for (const id of ids) {
          if (allOn) next.delete(id);
          else next.add(id);
        }
        return next;
      });
      setDirty(true);
    },
    [catalogue],
  );

  /**
   * Only cells the catalogue supports are sent. A stale `true` on an action later removed from
   * a module would be rejected by the API, and the admin would see a validation error naming a
   * checkbox that is no longer on their screen.
   */
  const toPermissions = useCallback(() => {
    if (!catalogue) return [];
    const out: string[] = [];
    for (const m of catalogue.modules) {
      for (const a of m.actions) {
        if (grants[m.id]?.[a]) out.push(`${m.id}:${a}`);
      }
    }
    return out;
  }, [catalogue, grants]);

  const toReports = useCallback(
    () => [...reports].filter((id) => catalogue?.reports.some((r) => r.id === id)),
    [catalogue, reports],
  );

  const markClean = useCallback(() => setDirty(false), []);

  // Unsaved ticks are easy to lose to a stray navigation, and the only signal would be the
  // permissions quietly not changing.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  return {
    grants,
    reports,
    dirty,
    reset,
    toggle,
    toggleRow,
    toggleColumn,
    toggleReport,
    toggleSurface,
    toPermissions,
    toReports,
    markClean,
  };
}
