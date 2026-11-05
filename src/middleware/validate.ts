import { NextFunction, Request, Response } from 'express';
import { ZodTypeAny } from 'zod';

type Schemas = { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny };

export const validate = (s: Schemas) => (req: Request, _res: Response, next: NextFunction) => {
  try {
    if (s.body) req.body = s.body.parse(req.body);
    if (s.query) req.query = s.query.parse(req.query);
    if (s.params) req.params = s.params.parse(req.params);
    next();
  } catch (e) {
    next(e);
  }
};
