import { Request, Response, NextFunction } from 'express';
import { ExpenseStatus } from '../../models/expense.model';
import { PaymentMethod } from '../../models/supplier-payment.model';
import * as expenses from './expenses.service';

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listCategories(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await expenses.listCategories({
        status: req.query.status as 'active' | 'inactive' | 'all' | undefined,
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function createCategory(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await expenses.createCategory(req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function updateCategory(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await expenses.updateCategory(req.params.id, req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, string>;
    res.json(
      await expenses.listExpenses({
        status: q.status as ExpenseStatus | 'all' | undefined,
        categoryId: q.categoryId,
        method: q.method as PaymentMethod | undefined,
        from: q.from,
        to: q.to,
        search: q.search,
        unclearedCheques: q.unclearedCheques === 'true',
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function summary(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, string>;
    res.json(await expenses.expenseSummary({ from: q.from, to: q.to }));
  } catch (err) {
    next(err);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await expenses.getExpense(req.params.id));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await expenses.createExpense(req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await expenses.updateExpense(req.params.id, req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await expenses.deleteExpense(req.params.id, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function submit(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await expenses.submitExpense(req.params.id, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function approve(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await expenses.approveExpense(req.params.id, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function reject(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await expenses.rejectExpense(req.params.id, req.body.reason, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function cancel(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await expenses.cancelExpense(req.params.id, req.body.reason, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function clearCheque(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await expenses.clearExpenseCheque(req.params.id, req.body.clearedOn, req.user!.userId),
    );
  } catch (err) {
    next(err);
  }
}
