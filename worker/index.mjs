import { DurableObject } from 'cloudflare:workers';
import { handleNebiusApi } from './nebius-api.mjs';
import { reserveDailyCall } from './nebius-budget.mjs';
import { handleNebiusRuns, NebiusRun } from './nebius-runs.mjs';
import { handleRecordedExample, RECORDED_EXAMPLE_PATH } from './nebius-recorded-example.mjs';
import { handleRecoveryExample, isRecoveryExamplePath } from './nebius-recovery-example.mjs';
import { handleBuildInfo } from './nebius-build-info.mjs';
import { preventFailedAssetCaching } from './asset-cache-guard.mjs';
import { RUN_LIMITS } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';

const RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

async function cleanExpiredReceipts(transaction, prefix, nowMs) {
  const receipts = await transaction.list({ prefix, limit: 512 });
  const expired = [];
  for (const [key, receipt] of receipts) {
    if (!receipt || typeof receipt.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(receipt.day)
      || !Number.isSafeInteger(receipt.expiresAt)) throw new Error('Invalid budget receipt.');
    if (receipt.expiresAt <= nowMs) expired.push(key);
  }
  if (expired.length) await transaction.delete(expired);
}

export class NebiusBudget extends DurableObject {
  reserve(limit) { return reserveDailyCall(this.ctx.storage, limit); }

  async reserveExecution(id, admissionId, attempt, limit, now = new Date()) {
    if (!validBudgetId(id) || !validBudgetId(admissionId) || !Number.isSafeInteger(attempt) || attempt < 1 || attempt > RUN_LIMITS.maxModelCalls || !Number.isSafeInteger(limit) || limit < 1 || limit > 10000) {
      throw new Error('Invalid execution budget request.');
    }
    const day = now.toISOString().slice(0, 10);
    const nowMs = now.getTime();
    const receiptKey = `execution:${id}:${admissionId}:${attempt}`;
    return this.ctx.storage.transaction(async transaction => {
      await cleanExpiredReceipts(transaction, 'execution:', nowMs);
      const [stored, storedReceipt] = await Promise.all([transaction.get('daily'), transaction.get(receiptKey)]);
      let receipt = storedReceipt;
      if (receipt?.expiresAt <= nowMs) { await transaction.delete(receiptKey); receipt = undefined; }
      if (receipt !== undefined) {
        if (!receipt || typeof receipt.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(receipt.day)
          || receipt.day > day || !Number.isSafeInteger(receipt.expiresAt) || receipt.expiresAt <= nowMs) throw new Error('Invalid execution budget receipt.');
        return true;
      }
      if (stored !== undefined && (!stored || typeof stored.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(stored.day)
        || !Number.isSafeInteger(stored.count) || stored.count < 0 || stored.day > day)) throw new Error('Invalid budget state.');
      const count = stored?.day === day ? stored.count : 0;
      if (count >= limit) return false;
      await transaction.put({ daily: { day, count: count + 1 }, [receiptKey]: { day, expiresAt: nowMs + RECEIPT_RETENTION_MS } });
      return true;
    });
  }
}

const validBudgetId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);

export class NebiusRunBudget extends DurableObject {
  async reserve(id, limit, now = new Date()) {
    if (!validBudgetId(id) || !Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw new Error('Invalid run budget request.');
    const day = now.toISOString().slice(0, 10);
    const nowMs = now.getTime();
    const receiptKey = `run:${id}`;
    return this.ctx.storage.transaction(async transaction => {
      await cleanExpiredReceipts(transaction, 'run:', nowMs);
      const [stored, storedReceipt] = await Promise.all([transaction.get('daily'), transaction.get(receiptKey)]);
      let receipt = storedReceipt;
      if (receipt?.expiresAt <= nowMs) { await transaction.delete(receiptKey); receipt = undefined; }
      if (receipt !== undefined) {
        if (!receipt || typeof receipt.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(receipt.day)
          || receipt.day > day || !Number.isSafeInteger(receipt.expiresAt) || receipt.expiresAt <= nowMs) throw new Error('Invalid run budget receipt.');
        return true;
      }
      if (stored !== undefined && (!stored || typeof stored.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(stored.day)
        || !Number.isSafeInteger(stored.count) || stored.count < 0 || stored.day > day)) throw new Error('Invalid run budget state.');
      const count = stored?.day === day ? stored.count : 0;
      if (count >= limit) return false;
      await transaction.put({ daily: { day, count: count + 1 }, [receiptKey]: { day, expiresAt: nowMs + RECEIPT_RETENTION_MS } });
      return true;
    });
  }
}

export { NebiusRun };

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (/^\/_app(?:-r191)?\/immutable\//u.test(path)) {
      const response = await env.ASSETS.fetch(request);
      return preventFailedAssetCaching(response);
    }
    if (path === '/api/nebius/build-info') return handleBuildInfo(request, env);
    if (path === RECORDED_EXAMPLE_PATH) return handleRecordedExample(request);
    if (isRecoveryExamplePath(path)) return handleRecoveryExample(request);
    if (path.startsWith('/api/nebius/runs/')) return handleNebiusRuns(request, env);
    if (path.startsWith('/api/nebius/')) return handleNebiusApi(request, env);
    return env.ASSETS.fetch(request);
  },
};
