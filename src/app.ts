import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import helmet from 'helmet';
import { env } from './config/env';
import { originGuard } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/error';
import { routes } from './routes';

export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1); // behind nginx / a load balancer
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } })); // lets the SPA show QR images from the API
app.use(cors({ origin: new URL(env.CLIENT_URL).origin, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }));
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }); // API responses hold personal data: never cache
// Attempts carry essay text: larger limit, registered first so it wins. Everything else stays at 100kb.
app.use('/api/attempts', express.json({ limit: '1mb' }));
app.use('/api/student/assignments', express.json({ limit: '1mb' }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(mongoSanitize()); // strips $ and . operators from input
app.use('/api', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use('/api', originGuard); // cross-site state-changing requests are refused before they reach any route
app.use('/api', routes);
app.use(notFoundHandler);
app.use(errorHandler);
