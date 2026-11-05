import QRCode from 'qrcode';
import { getAccessUrl } from '../services/examAccess.service';
import { asyncHandler } from '../utils/asyncHandler';
import { pid } from '../utils/params';

export const image = asyncHandler(async (req, res) => {
  const { format, download } = req.query as unknown as { format: 'png' | 'svg'; download: '0' | '1' };
  const url = await getAccessUrl(req.user!.id, pid(req));
  res.set('Cache-Control', 'no-store'); // the QR encodes a credential
  if (download === '1') {
    res.attachment(`exam-qr-${pid(req)}.${format}`);
  }
  if (format === 'svg') {
    res.type('image/svg+xml').send(await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 }));
  } else {
    res.type('image/png').send(await QRCode.toBuffer(url, { errorCorrectionLevel: 'M', margin: 2, width: 800 }));
  }
});

export const link = asyncHandler(async (req, res) => { res.json({ url: await getAccessUrl(req.user!.id, pid(req)) }); });
