import { Router } from 'express';

/**
 * Accounts & Finance — module root.
 *
 * Mounted at `/api/finance` and deliberately EMPTY at this step. It exists so the mount point,
 * the folder and the import are already in place, and the step that adds the chart of accounts
 * is a change to this module alone rather than a change that also touches `app.ts`.
 *
 * Two things the next step must do, recorded here because both fail silently otherwise:
 *
 *  1. When the first Swagger annotation block is added to a route file in this folder, add that
 *     file to BOTH lists in `config/swagger.ts` (the `.ts` entry and the `.js` entry).
 *     `test:swagger` exists precisely because seven modules once accumulated 52 endpoints that
 *     were annotated, unregistered, and therefore invisible in `/api/docs`.
 *
 *     That test counts the annotation marker as raw text, so writing the marker itself in a
 *     comment makes an empty file look documented. Both guards in this repo read source rather
 *     than parse it; keep example syntax out of prose.
 *
 *  2. Every route added here is gated by a permission key, and that key must be added to
 *     `constants/permissions.ts` FIRST. Guards are validated against the catalogue at startup,
 *     so a key that is not in the catalogue throws while the process boots rather than quietly
 *     denying every request in production.
 *
 *     Note for whoever writes that comment differently: `test:permissions` greps these files as
 *     raw text, so a realistic-looking example guard written inside a comment is picked up and
 *     checked as if it were code. Describe the keys, do not spell one out.
 */
const router = Router();

export default router;
