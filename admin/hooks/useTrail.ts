import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { TrailRef, trailFromQuery, trailToQuery } from '../services/financeService';
import { canViewReport } from '../utils/permissions';

/**
 * Owns the money-trail slide-over for one screen: the stack of figures visited, and the URL.
 *
 * The stack lives here rather than inside the panel so that opening a figure from the report is a
 * plain call that RESETS it. Held in the panel it would have to notice a new figure arriving and
 * reset itself in an effect, which means a render with the old breadcrumbs still on screen — and
 * a breadcrumb path the reader never walked is worse than none.
 *
 * The URL part matters: a figure somebody cannot explain is a figure they want to send to someone
 * else, and "click Balance Sheet, set these dates, then click the third row" does not survive
 * being pasted into a message.
 *
 * The open level travels in ONE query parameter, `trail`, holding the reference as its own encoded
 * query string. It used to be spread across the page's own parameters, and a trail's `ledgerId`,
 * `from` and `to` are the very names the Reports page reads for its Account Statement: reloading
 * after walking a trail made the statement adopt the trail's account and dates, and closing a trail
 * elsewhere left those names behind in the address bar. One key of its own collides with nothing,
 * and closing removes exactly it.
 *
 * Written with `router.replace` and `shallow`, so walking a trail adds nothing to browser history
 * and never re-runs the page's data fetching. Back then leaves the report rather than stepping back
 * through every level the reader looked at.
 */
export interface TrailController {
  /** Every level visited, oldest first. Empty when the panel is closed. */
  stack: TrailRef[];
  /** Start a fresh trail at this figure. */
  openTrail: (ref: TrailRef) => void;
  /** Go one level deeper. */
  pushTrail: (ref: TrailRef) => void;
  /** Jump back to a level already visited, dropping everything after it. */
  goToTrail: (index: number) => void;
  closeTrail: () => void;
}

/** The one query parameter a trail owns. */
const TRAIL_PARAM = 'trail';

/** Read a trail out of the page's query, or null when there is not a complete one. */
function trailInQuery(query: Record<string, unknown>): TrailRef | null {
  const raw = query[TRAIL_PARAM];
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const inner: Record<string, string> = {};
  new URLSearchParams(raw).forEach((value, key) => {
    inner[key] = value;
  });
  return trailFromQuery(inner);
}

export function useTrail(): TrailController {
  const router = useRouter();
  const [stack, setStack] = useState<TrailRef[]>([]);
  /** Adopt the URL once, on first load. After that the panel is the authority. */
  const adopted = useRef(false);

  useEffect(() => {
    if (adopted.current || !router.isReady) return;
    adopted.current = true;
    // A shared link opens the trail only for someone allowed to read it; anyone else sees the page
    // as if the link had no trail in it, rather than a panel that opens and is refused.
    const fromUrl = canViewReport('finance.trail')
      ? trailInQuery(router.query as Record<string, unknown>)
      : null;
    // Inside a condition that is true at most once per mount, so this settles immediately rather
    // than feeding a render loop.
    if (fromUrl) setStack([fromUrl]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  /** Put the level on screen into the address bar, or take the trail back out of it. */
  const writeUrl = useCallback(
    (ref: TrailRef | null) => {
      if (!router.isReady) return;
      // Every parameter the page put there stays exactly as it was; only the trail's own changes.
      const query: Record<string, string | string[]> = {};
      Object.entries(router.query).forEach(([key, value]) => {
        if (key !== TRAIL_PARAM && value !== undefined) query[key] = value;
      });
      if (ref) query[TRAIL_PARAM] = trailToQuery(ref);
      router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
    },
    [router],
  );

  const openTrail = useCallback(
    (ref: TrailRef) => {
      setStack([ref]);
      writeUrl(ref);
    },
    [writeUrl],
  );

  const pushTrail = useCallback(
    (ref: TrailRef) => {
      setStack((prev) => [...prev, ref]);
      writeUrl(ref);
    },
    [writeUrl],
  );

  const goToTrail = useCallback(
    (index: number) => {
      // Computed from the current stack rather than inside the updater. A state updater must be
      // pure: React calls it twice in development, which fired `router.replace` twice from here.
      const next = stack.slice(0, index + 1);
      if (next.length === 0) return;
      setStack(next);
      writeUrl(next[next.length - 1]);
    },
    [stack, writeUrl],
  );

  const closeTrail = useCallback(() => {
    setStack([]);
    writeUrl(null);
  }, [writeUrl]);

  return { stack, openTrail, pushTrail, goToTrail, closeTrail };
}
