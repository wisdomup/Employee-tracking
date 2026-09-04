import { Request, Response, NextFunction } from 'express';
import * as chartService from './chart.service';
import { AccountType } from './finance.rules';

export async function listGroups(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await chartService.listGroups());
  } catch (err) {
    next(err);
  }
}

export async function createGroup(req: Request, res: Response, next: NextFunction) {
  try {
    const group = await chartService.createGroup(req.body, req.user!.userId);
    res.status(201).json(group);
  } catch (err) {
    next(err);
  }
}

export async function updateGroup(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await chartService.updateGroup(req.params.id, req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function setGroupStatus(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await chartService.updateGroup(
        req.params.id,
        { isActive: req.body.isActive },
        req.user!.userId,
      ),
    );
  } catch (err) {
    next(err);
  }
}

export async function deleteGroup(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await chartService.deleteGroup(req.params.id, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function listLedgers(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, string>;
    res.json(
      await chartService.listLedgers({
        groupId: q.groupId,
        accountType: q.accountType as AccountType | undefined,
        // Query strings carry no booleans. Absent must stay absent rather than become `false`,
        // or every unfiltered list quietly hides the control accounts.
        isControl: q.isControl === undefined ? undefined : q.isControl === 'true',
        isCashEquivalent:
          q.isCashEquivalent === undefined ? undefined : q.isCashEquivalent === 'true',
        status: q.status as 'active' | 'inactive' | 'all' | undefined,
        search: q.search,
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function getLedger(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await chartService.getLedger(req.params.id));
  } catch (err) {
    next(err);
  }
}

export async function suggestCode(req: Request, res: Response, next: NextFunction) {
  try {
    const accountType = (req.query.accountType as AccountType) ?? 'asset';
    res.json({ code: await chartService.suggestLedgerCode(accountType) });
  } catch (err) {
    next(err);
  }
}

export async function createLedger(req: Request, res: Response, next: NextFunction) {
  try {
    const ledger = await chartService.createLedger(req.body, req.user!.userId);
    res.status(201).json(ledger);
  } catch (err) {
    next(err);
  }
}

export async function updateLedger(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await chartService.updateLedger(req.params.id, req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function setLedgerStatus(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await chartService.updateLedger(
        req.params.id,
        { isActive: req.body.isActive },
        req.user!.userId,
      ),
    );
  } catch (err) {
    next(err);
  }
}

export async function deleteLedger(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await chartService.deleteLedger(req.params.id, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function getSettings(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await chartService.getSettings());
  } catch (err) {
    next(err);
  }
}

export async function health(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await chartService.verifyLedgerMap());
  } catch (err) {
    next(err);
  }
}
