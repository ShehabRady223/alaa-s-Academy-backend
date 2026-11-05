import { Setting } from '../models/Setting';

export async function getSettings() {
  return Setting.findOneAndUpdate({ key: 'academy' }, { $setOnInsert: { key: 'academy' } }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
}

export async function updateSettings(input: Record<string, unknown>) {
  const s = await Setting.findOneAndUpdate({ key: 'academy' }, { $set: input }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
  return s;
}
