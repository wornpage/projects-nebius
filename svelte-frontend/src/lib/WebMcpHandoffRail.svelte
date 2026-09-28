<script lang="ts">
	import { webMcpHandoffSession } from './webmcp-handoff-store';
	import { webMcpHandoffTrailView } from './webmcp-handoff-session.mjs';

	const STEP_LABELS = {
		'work-scope': 'Work narrowed',
		'review-scope': 'Review verified',
		'next-proposal': 'Next prepared',
		'draft-batch': 'Drafts staged',
		'human-decision': 'Human decision'
	} as const;
	type TrailStep = {
		id: keyof typeof STEP_LABELS;
		title: string;
		summary: string;
		status: 'complete' | 'pending';
	};

	let trail = $derived(webMcpHandoffTrailView($webMcpHandoffSession) as {
		steps: TrailStep[];
		completedCount: number;
		pendingCount: number;
		currentStep: TrailStep | null;
		outcomeSummary: string;
	});
	let steps = $derived(trail.steps);
	let currentStep = $derived(trail.currentStep);
	let hasSteps = $derived(steps.length > 0);

	let progressAnnouncement = $derived(currentStep
		? `Action trail: ${trail.completedCount} verified actions, ${trail.pendingCount} pending. ${currentStep.title}.`
		: `Action trail ready. ${trail.outcomeSummary}. 0 verified actions, 0 pending.`);
</script>

<section
	class="webmcp-handoff-rail"
	class:has-pending={trail.pendingCount > 0}
	class:has-steps={hasSteps}
	data-webmcp-handoff-session
	aria-label="Verified action trail"
>
	<div class="webmcp-handoff-summary">
		<p>Verified action trail</p>
		<span class="webmcp-handoff-cue">Observe → Narrow → Prepare → Decide <small>(human-owned)</small></span>
		<strong>{currentStep ? `${trail.completedCount} verified${trail.pendingCount ? ` · ${trail.pendingCount} pending` : ''} · ${currentStep.title}` : 'Ready for one bounded run'}</strong>
		<small title={currentStep?.summary || undefined}>{currentStep?.summary || 'No agent action recorded.'}</small>
	</div>

	{#if hasSteps}
		<ol class="webmcp-handoff-steps" aria-label={`${trail.completedCount} verified actions, ${trail.pendingCount} pending`}>
			{#each steps as step, index (step.id)}
				<li
					class:is-complete={step.status === 'complete'}
					class:is-pending={step.status === 'pending'}
					class:is-current={step.id === currentStep?.id}
					data-webmcp-handoff-step={step.id}
					aria-label={`${STEP_LABELS[step.id]}: ${step.status}`}
				>
					<div class="webmcp-handoff-step-state">
						<span aria-hidden="true">{index + 1}</span>
						<b>{step.status === 'pending' ? 'Your decision' : 'Verified'}</b>
					</div>
					<small>{STEP_LABELS[step.id]}</small>
					<strong title={step.summary}>{step.summary}</strong>
				</li>
			{/each}
		</ol>
		<div class="webmcp-handoff-authority">
			<span>Recorded outcomes</span>
			<strong>{trail.outcomeSummary}</strong>
			<small>Human-only Start and final Save</small>
		</div>
	{/if}

	<span class="webmcp-handoff-progress" role="status" aria-live="polite" aria-atomic="true">{progressAnnouncement}</span>
</section>

<style>
	.webmcp-handoff-rail {
		align-items: start;
		background:
			linear-gradient(135deg, color-mix(in srgb, var(--worn-selected-bg) 58%, var(--worn-surface)), var(--worn-surface));
		border: 1px solid color-mix(in srgb, var(--worn-accent) 34%, var(--worn-border-strong));
		border-radius: var(--worn-radius);
		box-shadow: var(--worn-shadow-sm);
		display: grid;
		gap: 10px 16px;
		grid-template-columns: minmax(0, 1fr);
		min-width: 0;
		overflow: hidden;
		padding: 12px 14px;
		position: relative;
	}

	.webmcp-handoff-rail.has-pending {
		border-color: var(--worn-accent);
	}

	.webmcp-handoff-rail.has-steps {
		grid-template-columns: minmax(260px, 1fr) minmax(220px, auto);
	}

	.webmcp-handoff-summary,
	.webmcp-handoff-authority {
		display: grid;
		gap: 2px;
		min-width: 0;
	}

	.webmcp-handoff-summary p,
	.webmcp-handoff-summary strong,
	.webmcp-handoff-summary > small,
	.webmcp-handoff-cue,
	.webmcp-handoff-authority span,
	.webmcp-handoff-authority strong,
	.webmcp-handoff-authority small,
	.webmcp-handoff-steps {
		margin: 0;
	}

	.webmcp-handoff-summary p,
	.webmcp-handoff-authority span,
	.webmcp-handoff-steps li > small {
		color: var(--worn-link);
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.055em;
		text-transform: uppercase;
	}

	.webmcp-handoff-cue {
		color: var(--worn-text);
		font-family: var(--font-typewriter);
		font-size: clamp(12px, 1.6vw, 15px);
		font-weight: 750;
		line-height: 1.35;
	}

	.webmcp-handoff-cue small {
		color: var(--worn-text-muted);
		font-size: 11px;
		font-weight: 650;
		white-space: nowrap;
	}

	.webmcp-handoff-summary > strong {
		color: var(--worn-text-secondary);
		font-family: var(--font-typewriter);
		font-size: 11px;
		font-weight: 700;
		line-height: 1.35;
	}

	.webmcp-handoff-summary > small,
	.webmcp-handoff-authority small {
		color: var(--worn-text-secondary);
		font-size: 12px;
		line-height: 1.35;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.webmcp-handoff-authority {
		align-self: stretch;
		background: color-mix(in srgb, var(--worn-surface) 82%, transparent);
		border: 1px solid var(--worn-border);
		border-radius: var(--worn-radius-sm);
		justify-content: end;
		grid-column: 2;
		grid-row: 1;
		padding: 9px 11px;
		text-align: right;
	}

	.webmcp-handoff-authority strong {
		color: var(--worn-text);
		font-size: 14px;
		line-height: 1.3;
	}

	.webmcp-handoff-steps {
		display: grid;
		gap: 8px;
		grid-column: 1 / -1;
		grid-template-columns: repeat(auto-fit, minmax(min(170px, 100%), 1fr));
		list-style: none;
		padding: 0;
	}

	.webmcp-handoff-steps li {
		background: color-mix(in srgb, var(--worn-surface) 92%, transparent);
		border: 1px solid var(--worn-border);
		border-radius: var(--worn-radius-sm);
		display: grid;
		gap: 4px;
		min-width: 0;
		padding: 9px 10px;
	}

	.webmcp-handoff-step-state {
		align-items: center;
		display: flex;
		gap: 7px;
		justify-content: space-between;
	}

	.webmcp-handoff-step-state > span {
		align-items: center;
		background: var(--worn-surface);
		border: 1px solid var(--worn-border);
		border-radius: 999px;
		display: inline-flex;
		font-size: 11px;
		font-weight: 800;
		height: 22px;
		justify-content: center;
		width: 22px;
	}

	.webmcp-handoff-step-state > b {
		color: var(--worn-text-muted);
		font-family: var(--font-typewriter);
		font-size: 10px;
		font-weight: 750;
		text-transform: uppercase;
	}

	.webmcp-handoff-steps li > strong {
		color: var(--worn-text);
		font-size: 13px;
		line-height: 1.3;
		overflow-wrap: anywhere;
	}

	.webmcp-handoff-steps li.is-complete {
		border-color: color-mix(in srgb, var(--worn-accent) 58%, var(--worn-border));
	}

	.webmcp-handoff-steps li.is-complete .webmcp-handoff-step-state > span {
		background: var(--worn-selected-bg);
		border-color: var(--worn-accent);
	}

	.webmcp-handoff-steps li.is-pending {
		background: var(--worn-selected-bg);
		border-color: var(--worn-accent);
		border-style: dashed;
	}

	.webmcp-handoff-steps li.is-pending .webmcp-handoff-step-state > b {
		color: var(--worn-link);
	}

	.webmcp-handoff-steps li.is-current {
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--worn-accent) 30%, transparent);
		transform: translateY(-1px);
	}

	.webmcp-handoff-progress {
		clip: rect(0 0 0 0);
		clip-path: inset(50%);
		height: 1px;
		overflow: hidden;
		position: absolute;
		white-space: nowrap;
		width: 1px;
	}

	@media (max-width: 560px) {
		.webmcp-handoff-rail.has-steps {
			grid-template-columns: 1fr;
		}

		.webmcp-handoff-authority {
			grid-column: 1;
			grid-row: auto;
			max-width: none;
			text-align: left;
		}
	}

	@media (max-width: 460px) {
		.webmcp-handoff-steps {
			display: flex;
			overflow-x: auto;
			padding-bottom: 2px;
			scroll-snap-type: x proximity;
		}

		.webmcp-handoff-steps li {
			flex: 0 0 min(78vw, 250px);
			scroll-snap-align: start;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.webmcp-handoff-steps li.is-current {
			transform: none;
		}
	}
</style>
