import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodIssue, ZodTypeAny } from 'zod';

interface ValidationSchemas {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
}

function formatPath(issue: ZodIssue) {
  return issue.path.length > 0 ? issue.path.join('.') : 'request';
}

function formatDetails(issues: ZodIssue[]) {
  return issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: formatPath(issue),
  }));
}

function validateTarget(
  req: Request,
  res: Response,
  target: keyof ValidationSchemas,
  schema: ZodTypeAny | undefined,
) {
  if (!schema) return true;

  const result = schema.safeParse(req[target] || {});
  if (result.success) {
    Object.defineProperty(req, target, {
      configurable: true,
      enumerable: true,
      value: result.data,
      writable: true,
    });
    return true;
  }

  const details = formatDetails(result.error.issues);

  res.status(400).json({
    error: details.length === 1 ? details[0].message : 'Некорректные данные запроса',
    status: 400,
    code: 'VALIDATION_ERROR',
    details,
  });
  return false;
}

function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const order: Array<keyof ValidationSchemas> = ['params', 'query', 'body'];

    for (const target of order) {
      if (!validateTarget(req, res, target, schemas[target])) return;
    }

    next();
  };
}

module.exports = {
  validate,
};
