import { Router } from 'express';
import { Exam } from '../models/Exam';
import { finalizeOverdue } from '../services/attempt.service';
import { notifyUser } from '../services/notification.service';



const router = Router();

// Middleware to verify Vercel Cron Secret (security best practice)
const verifyVercelCron = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

router.post('/run-jobs', verifyVercelCron, async (req, res) => {
    try {
        // 1. Finalize overdue attempts
        const n = await finalizeOverdue();

        // 2. Exam expiration notifications
        const now = new Date();
        const soon = await Exam.find({
            status: 'published',
            expiresAt: { $gt: now, $lte: new Date(now.getTime() + 24 * 3600_000) },
            expiryNotifiedAt: { $exists: false }
        }).select('title expiresAt teacherId').lean();

        for (const e of soon) {
            const claimed = await Exam.updateOne({ _id: e._id, expiryNotifiedAt: { $exists: false } }, { expiryNotifiedAt: now });
            if (claimed.matchedCount) {
                await notifyUser(e.teacherId, 'exam_expiring', `"${e.title}" expires soon`, `Closes ${e.expiresAt?.toISOString()}`, { type: 'Exam', id: e._id });
            }
        }

        return res.status(200).json({ success: true, finalizedOverdue: n, notificationsSent: soon.length });
    } catch (e) {
        console.error('[cron] Job execution failed', e);
        return res.status(500).json({ error: 'Job execution failed' });
    }
});

export const cronRoutes = router;