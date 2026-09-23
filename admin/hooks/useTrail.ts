import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { TrailRef, trailFromQuery, trailToQuery } from '../services/financeService';

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
 * Trail parameters are written with `router.replace` and `shallow`, so walking a trail adds nothing
 * to browser history and never re-runs the page's data fetching. Back then leaves the report rather
 * than stepping back through every level the reader looked at.
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

export function useTrail(): TrailController {
  const router = useRouter();
  const [stack, setStack] = useState<TrailRef[]>([]);
  /** Adopt the URL once, on first load. After that the panel is the authority. */
  const adopted = useRef(false);

  useEffect(() => {
    if (adopted.current || !router.isReady) return;
    adopted.current = true;
    const fromUrl = trailFromQuery(router.query as Record<string, unknown>);
    // Inside a condition that is true at most once per mount, so this settles immediately rather
    // than feeding a render loop.
    if (fromUrl) setStack([fromUrl]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  /** Put the level on screen into the address bar, or take the trail parameters back out. */
  const writeUrl = useCallback(
    (ref: TrailRef | null) => {
      if (!router.isReady) return;
      const query: Record<string, string> = {};
      // Keep what the page itself put in the query (tab, ledgerId, dates) and replace only the
      // trail's own keys, so closing the panel does not reset the report behind it.
      Object.entries(router.query).forEach(([key, value]) => {
        if (typeof value === 'string' && !TRAIL_KEYS.has(key)) query[key] = value;
      });
      if (ref) {
        new URLSearchParams(trailToQuery(ref)).forEach((value, key) => {
          query[key] = value;
        });
      }
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
      setStack((prev) => {
        const next = prev.slice(0, index + 1);
        writeUrl(next[next.length - 1] ?? null);
        return next;
      });
    },
    [writeUrl],
  );

  const closeTrail = useCallback(() => {
    setStack([]);
    writeUrl(null);
  }, [writeUrl]);

  return { stack, openTrail, pushTrail, goToTrail, closeTrail };
}

/**
 * The query keys a trail owns.
 *
 * `ledgerId`, `from` and `to` are shared with the reports page, which uses them for its own Account
 * Statement filters. That is deliberate rather than a clash: a trail opened on an account and the
 * statement of that account are the same request, so one set of parameters describes both.
 */
const TRAIL_KEYS = new Set([
  'kind',
  'groupId',
  'entryId',
  'sourceId',
  'partyType',
  'partyId',
]);
