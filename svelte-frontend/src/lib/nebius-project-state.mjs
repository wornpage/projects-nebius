// @ts-nocheck -- runtime validation for the browser owner; public types are in .d.mts.
import { validatePlanInput, validateProjectPlan, PLAN_LIMITS } from './nebius-plan-contract.mjs';
import { normalizeWorkTitle } from './canonical-text.mjs';
import { DEMO_BLOCKER_NONE } from './workflow-rules.mjs';

// The task limit belongs to approved projects, not the pre-existing ungrouped workspace.
export const PROJECT_STATE_LIMITS = Object.freeze({ projects: 100, tasks: 1000 });
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
const PROJECT_KEYS = ['id', 'title', 'summary', 'brief', 'createdAt', 'source'];

function projectTaskCount(state) {
	return state.packs.filter((pack) => pack.projectId !== undefined).length;
}

export function assertProjectRecord(project) {
	if (!project || typeof project !== 'object' || Array.isArray(project) ||
		Object.keys(project).length !== PROJECT_KEYS.length || Object.keys(project).some((key) => !PROJECT_KEYS.includes(key))) {
		throw new TypeError('Saved project metadata is invalid.');
	}
	if (typeof project.id !== 'string' || !ID_PATTERN.test(project.id)) throw new TypeError('Project id is invalid.');
	for (const [field, limit] of [['title', PLAN_LIMITS.title], ['summary', PLAN_LIMITS.summary]]) {
		const controls = field === 'summary' ? /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u : /\p{Cc}/u;
		if (typeof project[field] !== 'string' || project[field].length > limit || controls.test(project[field]) || (field === 'title' && !project[field].trim())) {
			throw new TypeError(`Project ${field} is invalid.`);
		}
	}
	validatePlanInput({ brief: project.brief });
	if (project.source !== 'manual' && project.source !== 'nebius') throw new TypeError('Project source is invalid.');
	if (typeof project.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(project.createdAt) ||
		!Number.isFinite(Date.parse(project.createdAt)) || new Date(project.createdAt).toISOString() !== project.createdAt) {
		throw new TypeError('Project creation time must be an explicit valid UTC timestamp.');
	}
}

/** Validate project records and membership against the entire task graph. */
export function assertProjectState(state) {
	if (!state || !Array.isArray(state.packs)) throw new TypeError('Workspace tasks are invalid.');
	if (state.projects !== undefined && !Array.isArray(state.projects)) throw new TypeError('Workspace projects are invalid.');
	const projects = state.projects || [];
	if (projects.length > PROJECT_STATE_LIMITS.projects || projectTaskCount(state) > PROJECT_STATE_LIMITS.tasks) throw new TypeError('Local project workspace capacity exceeded.');
	const ids = new Set();
	for (const project of projects) {
		assertProjectRecord(project);
		if (ids.has(project.id)) throw new TypeError(`Duplicate project id "${project.id}".`);
		ids.add(project.id);
	}
	if (state.selectedProjectId !== undefined && state.selectedProjectId !== null && !ids.has(state.selectedProjectId)) throw new TypeError('Selected project does not exist.');
	const tasks = new Map(state.packs.map((pack) => [pack.id, pack]));
	for (const pack of state.packs) {
		if (pack.projectId !== undefined && (typeof pack.projectId !== 'string' || !ids.has(pack.projectId))) throw new TypeError(`Work item "${pack.id}" references a missing project.`);
		if (pack.projectId && pack.blockedBy && tasks.get(pack.blockedBy)?.projectId !== pack.projectId) throw new TypeError(`Project task "${pack.id}" has a dependency outside its project.`);
		if (pack.projectId) {
			const visited = new Set([pack.id]);
			let predecessor = pack.blockedBy;
			while (predecessor) {
				if (visited.has(predecessor)) throw new TypeError(`Project task "${pack.id}" has a cyclic dependency.`);
				visited.add(predecessor);
				predecessor = tasks.get(predecessor)?.blockedBy;
			}
		}
	}
}

/** Pure approval: validate everything before cloning and adding any records. */
export function createProjectPlanState(state, { brief, plan, approvalId, source, createdAt }) {
	assertProjectState(state);
	const input = validatePlanInput({ brief });
	const approvedPlan = validateProjectPlan(plan);
	const project = { id: approvalId, title: approvedPlan.title, summary: approvedPlan.summary, brief: input.brief, createdAt, source };
	assertProjectRecord(project);
	if ((state.projects || []).some((item) => item.id === approvalId) || state.packs.some((pack) => pack.id === approvalId || pack.id.startsWith(`${approvalId}:`))) {
		throw new TypeError('This approval id has already been used.');
	}
	if ((state.projects || []).length + 1 > PROJECT_STATE_LIMITS.projects || projectTaskCount(state) + approvedPlan.tasks.length > PROJECT_STATE_LIMITS.tasks) {
		throw new TypeError('Local project workspace capacity exceeded.');
	}
	const titles = new Map(approvedPlan.tasks.map((task) => [task.id, normalizeWorkTitle(task.title)]));
	if ([...titles.values()].some((title) => !title)) throw new TypeError('Plan contains an invalid work title.');
	const tasks = approvedPlan.tasks.map((task) => ({
		id: `${approvalId}:${task.id}`, projectId: approvalId, title: titles.get(task.id),
		purpose: task.purpose, nextStep: task.nextStep, doneWhen: task.doneWhen,
		next: 'Open', status: task.dependsOn ? 'blocked' : 'active',
		blocker: task.dependsOn ? `Waiting for ${titles.get(task.dependsOn)}`.slice(0, 200).replace(/[\uD800-\uDBFF]$/u, '') : DEMO_BLOCKER_NONE,
		...(task.dependsOn ? { blockedBy: `${approvalId}:${task.dependsOn}` } : {})
	}));
	const next = structuredClone(state);
	next.projects = [...(next.projects || []), project];
	next.packs.push(...tasks);
	next.selectedProjectId = project.id;
	next.selectedId = tasks[0].id;
	if (Array.isArray(next.manualOrder)) next.manualOrder.push(...tasks.map((task) => task.id));
	assertProjectState(next);
	return { state: next, project, tasks };
}

/** Refuse identity collisions rather than joining unrelated projects. */
export function mergedProjectRecords(current, imported) {
	assertProjectState(current);
	assertProjectState(imported);
	const projects = structuredClone(current.projects || []);
	for (const project of imported.projects || []) {
		const existing = projects.find((item) => item.id === project.id);
		if (existing && PROJECT_KEYS.some((field) => existing[field] !== project[field])) throw new TypeError(`Conflicting metadata for project "${project.id}".`);
		if (!existing) projects.push(structuredClone(project));
	}
	for (const pack of imported.packs) {
		const existing = current.packs.find((item) => item.id === pack.id);
		if (existing && existing.projectId !== pack.projectId) throw new TypeError(`Conflicting project membership for work item "${pack.id}".`);
	}
	return projects;
}
