import { Notification } from '../models/Notification';
import { notFound } from '../utils/errors';


export async function listNotifications(userId: string, q: { page: number; limit: number; unread?: boolean }) {
  const filter: Record<string, unknown> = { userId };
  if (q.unread) filter.readAt = { $exists: false };
  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ userId, readAt: { $exists: false } }),
  ]);
  return {
    items: items.map((n) => ({ id: String(n._id), type: n.type, title: n.title, body: n.body ?? null, entityType: n.entityType ?? null, entityId: n.entityId ? String(n.entityId) : null, read: !!n.readAt, createdAt: n.createdAt })),
    unreadCount, page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit),
  };
}

export async function markRead(userId: string, id: string) {
  const n = await Notification.findOneAndUpdate({ _id: id, userId }, { readAt: new Date() });
  if (!n) throw notFound('Notification not found');
}
export const markAllRead = (userId: string) => Notification.updateMany({ userId, readAt: { $exists: false } }, { readAt: new Date() });
