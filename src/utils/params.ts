import { Request } from 'express';
export const pid = (req: Request, name = 'id') => req.params[name] as string;
