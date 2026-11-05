import cron from 'node-cron';
import { Exam } from './models/Exam';
import { finalizeOverdue } from './services/attempt.service';
import { notifyUser } from './services/notification.service';

/** Both jobs are idempotent, so running several API instances is safe. */
export function startJobs() {
  // Grade attempts whose time ran out without a submit (tab closed, device died).
  cron.schedule('*/5 * * * *', async () => {
    try { const n = await finalizeOverdue(); if (n) console.log(`[jobs] finalized ${n} overdue attempt(s)`); }
    catch (e) { console.error('[jobs] finalizeOverdue failed', e); }
  });

  // "Exam expires within 24h": sent once per exam.
  cron.schedule('0 * * * *', async () => {
    try {
      const now = new Date();
      const soon = await Exam.find({ status: 'published', expiresAt: { $gt: now, $lte: new Date(now.getTime() + 24 * 3600_000) }, expiryNotifiedAt: { $exists: false } }).select('title expiresAt teacherId').lean();
      for (const e of soon) {
        const claimed = await Exam.updateOne({ _id: e._id, expiryNotifiedAt: { $exists: false } }, { expiryNotifiedAt: now });
        if (claimed.matchedCount) await notifyUser(e.teacherId, 'exam_expiring', `"${e.title}" expires soon`, `Closes ${e.expiresAt?.toISOString()}`, { type: 'Exam', id: e._id });
      }
    } catch (e) { console.error('[jobs] expiry notifications failed', e); }
  });
}
