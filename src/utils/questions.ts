import { randomBytes } from 'crypto';
import { Types } from 'mongoose';
import { Option, StoredQuestion } from '../types/exam';
import { QuestionInput } from '../validators/questions';

const optionId = () => randomBytes(4).toString('hex');

/** Turns editor input into the stored shape. Option ids are generated here, never trusted from the client. */
export function toStored(inputs: QuestionInput[], known: Set<string> = new Set()): StoredQuestion[] {
  const used = new Set<string>();
  return inputs.map((q) => {
    // A supplied id is honoured only if it is already one of THIS document's questions (so an edit keeps identity and a client
    // can never smuggle in another document's id). Everything else gets a fresh server-generated id.
    const questionId = q.id && known.has(q.id) && !used.has(q.id) ? new Types.ObjectId(q.id) : new Types.ObjectId();
    used.add(String(questionId));
    let options: Option[] = [], correctOptionIds: string[] = [], acceptedAnswers: string[] = [], caseSensitive = false;
    switch (q.type) {
      case 'multiple_choice': case 'multiple_select':
        options = q.options.map((o) => ({ id: optionId(), text: o.text }));
        correctOptionIds = options.filter((_, i) => q.options[i]?.isCorrect).map((o) => o.id);
        break;
      case 'true_false': options = [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }]; correctOptionIds = [q.correctAnswer ? 'true' : 'false']; break;
      case 'short_answer': acceptedAnswers = [...new Set(q.acceptedAnswers)]; caseSensitive = q.caseSensitive; break;
      case 'essay': break; // graded by the teacher
    }
    return { questionId, type: q.type, text: q.text, options, correctOptionIds, acceptedAnswers, caseSensitive, points: q.points, topic: q.topic || null, explanation: q.explanation ?? null, image: q.image ?? null };
  });
}

export const totalPoints = (qs: { points: number }[]) => Math.round(qs.reduce((s, q) => s + q.points, 0) * 100) / 100;
