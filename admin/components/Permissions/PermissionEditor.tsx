import React, { useMemo } from 'react';
import type { ActionId, Catalogue, ModuleGrant } from '../../services/permissionService';
import styles from '../../styles/Permissions.module.scss';

/**
 * The module grid and the report checklist, shared by the role/profile matrix screen and the
 * per-user editor.
 *
 * Extracted rather than duplicated because the two screens must agree on the parts that are
 * easy to get subtly wrong — which action cells render as `n/a`, how the row and column
 * "all" shortcuts behave, and the fact that reports carry one tick and no export. Two copies
 * of that would drift, and the drift would be invisible until an admin ticked something that
 * did nothing.
 *
 * Purely presentational: it owns no state and saves nothing. The parent decides what a change
 * means, which is what lets the same grid serve a role, a profile and one person.
 */

export const ACTION_LABELS: Record<ActionId, string> = {
  view: 'View',
  add: 'Add',
  edit: 'Edit',
  delete: 'Delete',
  change: 'Change',
};

interface Props {
  catalogue: Catalogue;
  grants: Record<string, ModuleGrant>;
  reports: Set<string>;
  onToggle: (moduleId: string, action: ActionId) => void;
  onToggleRow: (moduleId: string, actions: ActionId[]) => void;
  onToggleColumn: (action: ActionId) => void;
  onToggleReport: (reportId: string) => void;
  onToggleSurface: (surface: string) => void;
  /** Rendered between the module grid and the reports, for screen-specific context. */
  betweenSections?: React.ReactNode;
  /** Label shown beside each section heading, e.g. a role name or a person's name. */
  subjectLabel: string;
}

const PermissionEditor: React.FC<Props> = ({
  catalogue,
  grants,
  reports,
  onToggle,
  onToggleRow,
  onToggleColumn,
  onToggleReport,
  onToggleSurface,
  betweenSections,
  subjectLabel,
}) => {
  // Groups and surfaces come out in catalogue order, so the screen matches the order the
  // backend declares them in rather than an alphabetical shuffle that means nothing.
  const groups = useMemo(() => {
    const order: string[] = [];
    for (const m of catalogue.modules) if (!order.includes(m.group)) order.push(m.group);
    return order.map((group) => ({
      group,
      items: catalogue.modules.filter((m) => m.group === group),
    }));
  }, [catalogue]);

  const surfaces = useMemo(() => {
    const order: string[] = [];
    for (const r of catalogue.reports) if (!order.includes(r.surface)) order.push(r.surface);
    return order.map((surface) => ({
      surface,
      items: catalogue.reports.filter((r) => r.surface === surface),
    }));
  }, [catalogue]);

  const grantedCount = catalogue.modules.reduce(
    (n, m) => n + m.actions.filter((a) => grants[m.id]?.[a]).length,
    0,
  );

  return (
    <>
      <h2 className={styles.sectionTitle}>
        Modules — {subjectLabel}{' '}
        <span className={styles.reportCount}>({grantedCount} granted)</span>
      </h2>

      <div className={styles.matrixWrap}>
        <table className={styles.matrix}>
          <thead>
            <tr>
              <th>Module</th>
              {catalogue.actions.map((a) => (
                <th key={a} className={styles.actionCell}>
                  {ACTION_LABELS[a]}
                  <button type="button" className={styles.colToggle} onClick={() => onToggleColumn(a)}>
                    all
                  </button>
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {groups.map(({ group, items }) => (
              <React.Fragment key={group}>
                <tr className={styles.groupRow}>
                  <td colSpan={catalogue.actions.length + 2}>{group}</td>
                </tr>
                {items.map((m) => (
                  <tr key={m.id}>
                    <td className={styles.moduleCell}>
                      {m.label}
                      {m.changeMeans && (
                        <span className={styles.changeHint}>Change: {m.changeMeans}</span>
                      )}
                    </td>
                    {catalogue.actions.map((a) =>
                      m.actions.includes(a) ? (
                        <td key={a} className={styles.actionCell}>
                          <input
                            type="checkbox"
                            className={styles.check}
                            checked={!!grants[m.id]?.[a]}
                            onChange={() => onToggle(m.id, a)}
                            aria-label={`${m.label} — ${ACTION_LABELS[a]}`}
                          />
                        </td>
                      ) : (
                        // Greyed, never an unchecked box: "not allowed" and "cannot be
                        // allowed" have to stay distinguishable.
                        <td
                          key={a}
                          className={styles.naCell}
                          title={`${ACTION_LABELS[a]} does not apply to ${m.label}`}
                        >
                          n/a
                        </td>
                      ),
                    )}
                    <td>
                      <button
                        type="button"
                        className={styles.rowToggle}
                        onClick={() => onToggleRow(m.id, m.actions)}
                      >
                        all
                      </button>
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {betweenSections}

      <h2 className={styles.sectionTitle}>
        Reports — {subjectLabel}{' '}
        <span className={styles.reportCount}>
          ({reports.size} of {catalogue.reports.length})
        </span>
      </h2>

      {surfaces.map(({ surface, items }) => {
        const on = items.filter((r) => reports.has(r.id)).length;
        return (
          <div key={surface} className={styles.reportSurface}>
            <div className={styles.reportSurfaceHead}>
              <h3>{surface}</h3>
              <span className={styles.reportCount}>
                {on} / {items.length}
                <button
                  type="button"
                  className={styles.colToggle}
                  onClick={() => onToggleSurface(surface)}
                >
                  {on === items.length ? 'clear all' : 'select all'}
                </button>
              </span>
            </div>
            <div className={styles.reportList}>
              {items.map((r) => (
                <label key={r.id} className={styles.reportItem}>
                  <input
                    type="checkbox"
                    className={styles.check}
                    checked={reports.has(r.id)}
                    onChange={() => onToggleReport(r.id)}
                  />
                  {r.label}
                </label>
              ))}
            </div>
            <p className={styles.viewOnlyNote}>
              View only. No export, print or download is available on these reports for any role.
            </p>
          </div>
        );
      })}
    </>
  );
};

export default PermissionEditor;
