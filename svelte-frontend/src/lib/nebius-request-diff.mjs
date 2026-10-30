import { diffWordsWithSpace } from 'diff';

const CONTEXT = 80;

/** Bounded presentation only. Exact task matching remains the staleness authority. */
export function requestTextDiff(saved, current) {
  const originals = { saved, current, whitespaceOnly: saved !== current && saved.replace(/\s/gu, '') === current.replace(/\s/gu, '') };
  if (saved === current) return { ...originals, status: 'unchanged', segments: [{ kind: 'unchanged', text: saved }] };
  const changes = diffWordsWithSpace(saved, current, { timeout: 25, maxEditLength: 512 });
  // A budget cutoff has no trustworthy partial result. Always retain both originals.
  if (!changes) return { ...originals, status: 'cutoff', segments: [] };
  const segments = [];
  for (let index = 0; index < changes.length; index++) {
    const change = changes[index];
    if (change.added || change.removed) {
      segments.push({ kind: change.added ? 'added' : 'removed', text: change.value });
      continue;
    }
    const points = Array.from(change.value);
    const leading = index === 0;
    const trailing = index === changes.length - 1;
    const head = leading ? 0 : Math.min(CONTEXT, points.length);
    const tail = trailing ? 0 : Math.min(CONTEXT, points.length);
    // Overlapping context windows merge into one unchanged span.
    if (head + tail >= points.length) {
      segments.push({ kind: 'unchanged', text: change.value });
    } else {
      if (head) segments.push({ kind: 'unchanged', text: points.slice(0, head).join('') });
      segments.push({ kind: 'omission', count: points.length - head - tail });
      if (tail) segments.push({ kind: 'unchanged', text: points.slice(-tail).join('') });
    }
  }
  return { ...originals, status: 'compared', segments };
}
