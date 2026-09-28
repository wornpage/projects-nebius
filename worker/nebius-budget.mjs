// Reserve before inference. Failed attempts remain counted because they may bill.
export async function reserveDailyCall(storage, limit, now = new Date()) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw new Error('Invalid daily call limit.');
  const day = now.toISOString().slice(0, 10);
  return storage.transaction(async transaction => {
    const stored = await transaction.get('daily');
    if (stored !== undefined && (!stored || typeof stored.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(stored.day)
      || !Number.isSafeInteger(stored.count) || stored.count < 0 || stored.day > day)) throw new Error('Invalid budget state.');
    const count = stored?.day === day ? stored.count : 0;
    if (count >= limit) return false;
    await transaction.put('daily', { day, count: count + 1 });
    return true;
  });
}
