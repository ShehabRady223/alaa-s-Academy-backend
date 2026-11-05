import { Response } from 'express';
import PDFDocument from 'pdfkit';
import { Exam } from '../models/Exam';
import { ExamAttempt } from '../models/ExamAttempt';
import { User } from '../models/User';
import { Cell, toCsv } from '../utils/csv';
import { studentProfileDetail } from './analytics.service';
import { getSettings } from './settings.service';

const MAX_ROWS = 10_000;

export async function resultsCsv(tid: string, q: { examId?: string; studentId?: string }) {
  const filter: Record<string, unknown> = { teacherId: tid, status: { $in: ['graded', 'pending_review'] } };
  if (q.examId) filter.examId = q.examId;
  if (q.studentId) filter.studentId = q.studentId;
  const attempts = await ExamAttempt.find(filter).sort({ submittedAt: -1 }).limit(MAX_ROWS).select('-answers -layout').lean();
  const [users, exams] = await Promise.all([
    User.find({ _id: { $in: attempts.map((a) => a.studentId) } }).select('name email').lean(),
    Exam.find({ _id: { $in: attempts.map((a) => a.examId) } }).select('title').lean(),
  ]);
  const u = new Map(users.map((x) => [String(x._id), x]));
  const e = new Map(exams.map((x) => [String(x._id), x.title]));
  const rows: Cell[][] = [['Student', 'Email', 'Exam', 'Attempt', 'Status', 'Score', 'Max score', 'Percentage', 'Passed', 'Submitted at', 'Time taken (min)']];
  for (const a of attempts) {
    const s = u.get(String(a.studentId));
    rows.push([s?.name, s?.email, e.get(String(a.examId)), a.attemptNumber, a.status, a.score, a.maxScore, a.percentage, a.passed == null ? '' : a.passed ? 'Yes' : 'No', a.submittedAt, a.timeTakenSec == null ? '' : Math.round((a.timeTakenSec / 60) * 10) / 10]);
  }
  return toCsv(rows);
}

type Detail = Awaited<ReturnType<typeof studentProfileDetail>>;
const fmtDate = (d?: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : '-');
const BRAND = '#0f5c4a';

export async function streamStudentReport(res: Response, tid: string, studentId: string) {
  const [d, settings] = await Promise.all([studentProfileDetail(tid, studentId), getSettings()]);
  res.type('application/pdf').attachment(`performance-report-${studentId}.pdf`);
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Performance report - ${d.student.name}` } });
  doc.pipe(res);
  writeReport(doc, d, settings?.academyName ?? "Alaa's Academy");
  doc.end();
}

export function writeReport(doc: PDFKit.PDFDocument, d: Detail, academy: string) {
  const L = 48, W = doc.page.width - 96, bottom = doc.page.height - 60;
  let y = 48;
  const space = (h: number) => { if (y + h > bottom) { doc.addPage(); y = 48; } };
  const h2 = (t: string) => { space(40); y += 10; doc.font('Helvetica-Bold').fontSize(12).fillColor(BRAND).text(t, L, y); y += 18; doc.moveTo(L, y - 3).lineTo(L + W, y - 3).strokeColor('#d4d4d4').lineWidth(0.5).stroke(); };
  const row = (cells: string[], widths: number[], bold = false) => {
    space(18); doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(bold ? '#525252' : '#171717');
    let x = L; cells.forEach((c, i) => { doc.text(c, x, y, { width: widths[i]! - 6, lineBreak: false, ellipsis: true }); x += widths[i]!; }); y += 16;
  };

  doc.font('Helvetica-Bold').fontSize(16).fillColor('#171717').text(academy, L, y); y += 22;
  doc.font('Helvetica').fontSize(10).fillColor('#525252').text(`Student performance report  |  Generated ${fmtDate(new Date())}`, L, y); y += 22;

  h2('Student');
  const p = d.student.profile as { phone?: string; level?: string } | null;
  [['Name', d.student.name], ['Email', d.student.email], ['Level', p?.level ?? '-'], ['Phone', p?.phone ?? '-']].forEach(([k, v]) => {
    space(14); doc.font('Helvetica').fontSize(9).fillColor('#525252').text(k!, L, y, { width: 70 }); doc.fillColor('#171717').text(v!, L + 70, y, { width: W - 70 }); y += 14;
  });

  const o = d.overview;
  h2('Overall');
  row(['Exams completed', 'Average', 'Highest', 'Lowest', 'Trend'], [110, 90, 90, 90, 100], true);
  row([`${o.completedExams} of ${o.assignedExams}`, o.averagePercentage == null ? '-' : `${o.averagePercentage}%`, o.highestPercentage == null ? '-' : `${o.highestPercentage}%`, o.lowestPercentage == null ? '-' : `${o.lowestPercentage}%`, o.trend.replace('_', ' ')], [110, 90, 90, 90, 100]);

  h2('Performance over time');
  const pts = d.performanceOverTime.slice(-20);
  if (pts.length < 2) { doc.font('Helvetica').fontSize(9).fillColor('#737373').text('Not enough graded exams yet.', L, y); y += 16; }
  else {
    space(150); const cx = L + 28, cw = W - 36, cy = y + 4, ch = 120;
    doc.strokeColor('#e5e5e5').lineWidth(0.5).fontSize(7).fillColor('#737373');
    [0, 50, 100].forEach((v) => { const yy = cy + ch - (v / 100) * ch; doc.moveTo(cx, yy).lineTo(cx + cw, yy).stroke(); doc.text(`${v}%`, L, yy - 3, { width: 24, align: 'right' }); });
    doc.strokeColor(BRAND).lineWidth(1.5);
    pts.forEach((pt, i) => { const px = cx + (i / (pts.length - 1)) * cw, py = cy + ch - ((pt.percentage ?? 0) / 100) * ch; if (i === 0) doc.moveTo(px, py); else doc.lineTo(px, py); });
    doc.stroke();
    doc.fillColor(BRAND);
    pts.forEach((pt, i) => doc.circle(cx + (i / (pts.length - 1)) * cw, cy + ch - ((pt.percentage ?? 0) / 100) * ch, 2.2).fill());
    doc.font('Helvetica').fontSize(7).fillColor('#737373');
    doc.text(fmtDate(pts[0]!.date), cx, cy + ch + 5, { width: 80, lineBreak: false });
    doc.text(fmtDate(pts[pts.length - 1]!.date), cx + cw - 80, cy + ch + 5, { width: 80, align: 'right', lineBreak: false });
    y += ch + 24;
  }

  h2('Exam history');
  const hw = [62, 210, 70, 60, 60];
  row(['Date', 'Exam', 'Score', '%', 'Result'], hw, true);
  if (!d.history.length) { doc.font('Helvetica').fontSize(9).fillColor('#737373').text('No exams taken yet.', L, y); y += 16; }
  d.history.slice(0, 40).forEach((h) => row([fmtDate(h.submittedAt), h.examTitle, h.score == null ? '-' : `${h.score}/${h.maxScore}`, h.percentage == null ? 'pending' : `${h.percentage}%`, h.passed == null ? 'In review' : h.passed ? 'Passed' : 'Not passed'], hw));

  h2('Topic performance');
  if (!d.subjects.length) { doc.font('Helvetica').fontSize(9).fillColor('#737373').text('No graded answers yet.', L, y); y += 16; }
  for (const s of d.subjects) {
    space(30); doc.font('Helvetica-Bold').fontSize(10).fillColor('#171717').text(`${s.subject}  ${s.percentage}%`, L, y); y += 15;
    for (const t of s.topics) {
      space(16); doc.font('Helvetica').fontSize(9).fillColor('#404040').text(t.topic, L + 10, y, { width: 150, lineBreak: false, ellipsis: true });
      doc.rect(L + 170, y + 2, 200, 7).fillColor('#e5e5e5').fill();
      doc.rect(L + 170, y + 2, 2 * t.percentage, 7).fillColor(t.percentage >= 80 ? '#15803d' : t.percentage >= 60 ? BRAND : '#b45309').fill();
      doc.fillColor('#404040').text(`${t.percentage}%  (${t.questions} q)`, L + 378, y, { width: 90, lineBreak: false }); y += 15;
    }
  }

  h2('Strengths'); list(d.strengths.map((t) => `${t.subject}: ${t.topic} (${t.percentage}%)`), 'No clear strengths yet (needs at least 3 answered questions per topic).');
  h2('Areas that need improvement'); list(d.weaknesses.map((t) => `${t.subject}: ${t.topic} (${t.percentage}%)`), 'No weak areas identified.');
  function list(items: string[], empty: string) {
    if (!items.length) { doc.font('Helvetica').fontSize(9).fillColor('#737373').text(empty, L, y); y += 16; return; }
    items.forEach((t) => { space(14); doc.font('Helvetica').fontSize(9).fillColor('#171717').text(`-  ${t}`, L + 4, y); y += 14; });
  }
}
