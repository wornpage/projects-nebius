// Hand-calculated expectations. This fixture never imports or calls the scheduler.
export const PROJECT_TASKS = [
  { id: 'brief', title: 'Confirm brief', duration: 1, dependsOn: [] },
  { id: 'delivery', title: 'Delivery', duration: 3, dependsOn: ['brief'] },
  { id: 'prepare', title: 'Prepare workspace', duration: 2, dependsOn: ['brief'] },
  { id: 'assemble', title: 'Assembly', duration: 2, dependsOn: ['delivery', 'prepare'] },
  { id: 'review', title: 'Review', duration: 1, dependsOn: ['assemble'] },
];

const original = [['brief', 0, 1], ['delivery', 1, 4], ['prepare', 1, 3], ['assemble', 4, 6], ['review', 6, 7]];
const deliveryDelayed = [['brief', 0, 1], ['delivery', 1, 6], ['prepare', 1, 3], ['assemble', 6, 8], ['review', 8, 9]];
const assemblyRecovered = [['brief', 0, 1], ['delivery', 1, 6], ['prepare', 1, 3], ['assemble', 6, 7], ['review', 7, 8]];
const independent = [
  { id: 'join', title: 'Join', duration: 1, dependsOn: ['a', 'b'] },
  { id: 'b', title: 'Branch B', duration: 2, dependsOn: [] },
  { id: 'a', title: 'Branch A', duration: 4, dependsOn: [] },
];
const tied = [
  { id: 'join', title: 'Join', duration: 1, dependsOn: ['a', 'b'] },
  { id: 'b', title: 'Branch B', duration: 3, dependsOn: [] },
  { id: 'a', title: 'Branch A', duration: 3, dependsOn: [] },
];

export const RECOVERY_CASES = [
  { name: 'baseline finishes on day 7', input: { tasks: PROJECT_TASKS },
    finishes: [7, 7, 7], daysRecovered: 0, baseline: original, delayed: original, recovered: original, affected: [] },
  { name: 'critical delivery delay moves descendants and finish', input: { tasks: PROJECT_TASKS, delayTask: 'delivery', delayDays: 2 },
    finishes: [7, 9, 9], daysRecovered: 0, baseline: original, delayed: deliveryDelayed, recovered: deliveryDelayed,
    affected: ['delivery', 'assemble', 'review'] },
  { name: 'assembly recovery saves one projected day', input: { tasks: PROJECT_TASKS, delayTask: 'delivery', delayDays: 2, recoverTask: 'assemble', recoverDays: 1 },
    finishes: [7, 9, 8], daysRecovered: 1, baseline: original, delayed: deliveryDelayed, recovered: assemblyRecovered,
    affected: ['delivery', 'assemble', 'review'] },
  { name: 'one-day noncritical delay uses branch slack', input: { tasks: PROJECT_TASKS, delayTask: 'prepare', delayDays: 1 },
    finishes: [7, 7, 7], daysRecovered: 0, baseline: original,
    delayed: [['brief', 0, 1], ['delivery', 1, 4], ['prepare', 1, 4], ['assemble', 4, 6], ['review', 6, 7]],
    recovered: [['brief', 0, 1], ['delivery', 1, 4], ['prepare', 1, 4], ['assemble', 4, 6], ['review', 6, 7]], affected: ['prepare'] },
  { name: 'two-day noncritical delay becomes critical', input: { tasks: PROJECT_TASKS, delayTask: 'prepare', delayDays: 2 },
    finishes: [7, 8, 8], daysRecovered: 0, baseline: original,
    delayed: [['brief', 0, 1], ['delivery', 1, 4], ['prepare', 1, 5], ['assemble', 5, 7], ['review', 7, 8]],
    recovered: [['brief', 0, 1], ['delivery', 1, 4], ['prepare', 1, 5], ['assemble', 5, 7], ['review', 7, 8]], affected: ['prepare', 'assemble', 'review'] },
  { name: 'independent branches run together and join at maximum', input: { tasks: independent, delayTask: 'b', delayDays: 1, recoverTask: 'a', recoverDays: 1 },
    finishes: [5, 5, 4], daysRecovered: 1,
    baseline: [['a', 0, 4], ['b', 0, 2], ['join', 4, 5]],
    delayed: [['a', 0, 4], ['b', 0, 3], ['join', 4, 5]],
    recovered: [['a', 0, 3], ['b', 0, 3], ['join', 3, 4]], affected: ['a', 'b', 'join'] },
  { name: 'input ordering does not control dependency scheduling', input: { tasks: [...PROJECT_TASKS].reverse() },
    finishes: [7, 7, 7], daysRecovered: 0, baseline: original, delayed: original, recovered: original, affected: [] },
  { name: 'shortening one tied branch does not recover project days', input: { tasks: tied, recoverTask: 'a', recoverDays: 1 },
    finishes: [4, 4, 4], daysRecovered: 0,
    baseline: [['a', 0, 3], ['b', 0, 3], ['join', 3, 4]], delayed: [['a', 0, 3], ['b', 0, 3], ['join', 3, 4]],
    recovered: [['a', 0, 2], ['b', 0, 3], ['join', 3, 4]], affected: ['a'] },
  { name: 'zero recovery leaves delayed comparison intact', input: { tasks: PROJECT_TASKS, delayTask: 'delivery', delayDays: 2, recoverTask: 'assemble', recoverDays: 0 },
    finishes: [7, 9, 9], daysRecovered: 0, baseline: original, delayed: deliveryDelayed, recovered: deliveryDelayed,
    affected: ['delivery', 'assemble', 'review'] },
  { name: 'recovery applies after delay on the same task', input: { tasks: PROJECT_TASKS, delayTask: 'delivery', delayDays: 2, recoverTask: 'delivery', recoverDays: 3 },
    finishes: [7, 9, 6], daysRecovered: 3, baseline: original, delayed: deliveryDelayed,
    recovered: [['brief', 0, 1], ['delivery', 1, 3], ['prepare', 1, 3], ['assemble', 3, 5], ['review', 5, 6]],
    affected: ['delivery', 'assemble', 'review'] },
  { name: 'safe inherited-object-name ID is scheduled as data', input: { tasks: [{ id: 'toString', title: 'Plain task', duration: 2, dependsOn: [] }] },
    finishes: [2, 2, 2], daysRecovered: 0, baseline: [['toString', 0, 2]], delayed: [['toString', 0, 2]], recovered: [['toString', 0, 2]], affected: [] },
  { name: '90-day horizon is inclusive', input: { tasks: [
    { id: 'a', title: 'A', duration: 30, dependsOn: [] },
    { id: 'b', title: 'B', duration: 30, dependsOn: ['a'] },
    { id: 'c', title: 'C', duration: 30, dependsOn: ['b'] },
  ], recoverTask: 'c', recoverDays: 1 }, finishes: [90, 90, 89], daysRecovered: 1,
    baseline: [['a', 0, 30], ['b', 30, 60], ['c', 60, 90]], delayed: [['a', 0, 30], ['b', 30, 60], ['c', 60, 90]],
    recovered: [['a', 0, 30], ['b', 30, 60], ['c', 60, 89]], affected: ['c'] },
];
