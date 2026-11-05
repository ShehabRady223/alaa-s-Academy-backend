import { Types } from 'mongoose';
import { Notification } from '../models/Notification';

/** Notifies one teacher (the owner of the thing that happened), never every teacher. */
export async function notifyUser(
  userId: string | Types.ObjectId, type: string, title: string, body: string, entity?: { type: string; id: string | Types.ObjectId },
) {
  try {
    await Notification.create({ userId, type, title, body, entityType: entity?.type, entityId: entity?.id });
  } catch (err) {
    console.error('Failed to create notification', err);
  }
}
