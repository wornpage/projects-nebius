import { isRecord, validateTask } from './nebius-contract.mjs';

export const REVIEW_VERSION = 'nebius-review.v3';
export const REVIEW_LIMITS = Object.freeze({ criteria: 3, criterionText: 500, evidence: 2000, explanation: 600, quote: 500 });
const badControl = /[\u0000-\u0008\u000b-\u001f\u007f]/u;
const exactKeys = (value, keys) => isRecord(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

export function validateReviewInput(value) {
  if (!exactKeys(value, ['pack', 'criteria', 'evidence']) || !Array.isArray(value.criteria)
    || value.criteria.length < 1 || value.criteria.length > REVIEW_LIMITS.criteria
    || typeof value.evidence !== 'string' || !value.evidence.trim() || value.evidence.length > REVIEW_LIMITS.evidence
    || badControl.test(value.evidence)) throw new TypeError('Select criteria and supply bounded evidence.');
  const pack = validateTask(value.pack);
  const criteria = value.criteria.map((item, index) => {
    if (!exactKeys(item, ['id', 'text']) || item.id !== `c${index + 1}`
      || typeof item.text !== 'string' || !item.text.trim() || item.text.length > REVIEW_LIMITS.criterionText
      || /\p{Cc}/u.test(item.text)) throw new TypeError('Review criteria are invalid.');
    return { id: item.id, text: item.text };
  });
  return { pack, criteria, evidence: value.evidence };
}

export function validateReviewOutput(value, input) {
  const selected = validateReviewInput(input);
  if (!exactKeys(value, ['checks', 'comparison']) || !Array.isArray(value.checks)
    || value.checks.length !== selected.criteria.length
    || !exactKeys(value.comparison, ['assessment', 'reason'])
    || !['aligned', 'mismatched', 'unclear'].includes(value.comparison.assessment)
    || typeof value.comparison.reason !== 'string' || !value.comparison.reason.trim()
    || value.comparison.reason.length > REVIEW_LIMITS.explanation || badControl.test(value.comparison.reason)) {
    throw new TypeError('Review output is incomplete.');
  }
  const checks = value.checks.map((item, index) => {
    if (!exactKeys(item, ['id', 'assessment', 'reason', 'quote']) || item.id !== selected.criteria[index].id
      || !['supported', 'partial', 'not_evidenced', 'unclear'].includes(item.assessment)
      || typeof item.reason !== 'string' || !item.reason.trim() || item.reason.length > REVIEW_LIMITS.explanation
      || badControl.test(item.reason) || typeof item.quote !== 'string' || item.quote.length > REVIEW_LIMITS.quote
      || badControl.test(item.quote) || (item.quote && !selected.evidence.includes(item.quote))
      || (['supported', 'partial'].includes(item.assessment) && !item.quote)) {
      throw new TypeError('Review finding is unsupported by the supplied input.');
    }
    return { id: item.id, assessment: item.assessment, reason: item.reason, quote: item.quote };
  });
  return { checks, comparison: { assessment: value.comparison.assessment, reason: value.comparison.reason }, selectedCount: selected.criteria.length, exhaustive: false };
}
