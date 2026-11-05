import { z } from 'zod';
import { STUDENT_STATUSES } from '../models/StudentProfile';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const idParams = z.object({ id: objectId });

const profileFields = {
  phone: z.string().trim().max(30).optional(),
  dateOfBirth: z.coerce.date().optional(),
  level: z.string().trim().max(60).optional(),
  notes: z.string().max(2000).optional(),
};

export const createStudentBody = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  ...profileFields,
});

export const updateStudentBody = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email(),
    status: z.enum(['active', 'disabled']),
    ...profileFields,
  })
  .partial();

export const listStudentsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  status: z.enum(STUDENT_STATUSES).optional(),
  sortBy: z.enum(['name', 'email', 'createdAt']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
});
export type ListStudentsQuery = z.infer<typeof listStudentsQuery>;
