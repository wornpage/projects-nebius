<script lang="ts">
	import { ENERGY_OPTIONS } from '$lib/demo-workflow';
	import { WornChip, WornCollapsible, WornInput, WornSelect, WornTabs, WornToolbar } from '$lib/components';
	import { WORK_SEARCH_MAX_LENGTH } from './work-view-helpers.mjs';

	type Density = 'card' | 'grid';
	type FilterOption = { value: string; label: string };
	type WorkMetadata = {
		uniqueAreas: string[];
		uniqueRecurrences: string[];
		uniqueOwners: string[];
		countByEnergy: Record<string, number>;
		countByArea: Record<string, number>;
		countByRecurrence: Record<string, number>;
		countByOwner: Record<string, number>;
		countByDueUrgency: Record<string, number>;
		hasDoneWork: boolean;
	};

	let {
		filter,
		statusFilterOptions,
		query = $bindable(''),
		workMetadata,
		energyFilter = $bindable('all'),
		areaFilter = $bindable('all'),
		recurrenceFilter = $bindable('all'),
		ownerFilter = $bindable('all'),
		dueUrgencyFilter = $bindable('all'),
		sortBy = $bindable('urgency'),
		hideDone = $bindable(false),
		hideDoneApplies,
		density = $bindable<Density>('grid'),
		secondaryFiltersOpen = $bindable(false),
		densityTabs,
		energyDragTarget,
		packCount,
		onStatusFilterChange,
		onClearAllFilters,
		onEnergyDragOver,
		onEnergyDragLeave,
		onEnergyDrop,
		onDensityChange,
		onInteraction
	}: {
		filter: string;
		statusFilterOptions: FilterOption[];
		query?: string;
		workMetadata: WorkMetadata;
		energyFilter?: string;
		areaFilter?: string;
		recurrenceFilter?: string;
		ownerFilter?: string;
		dueUrgencyFilter?: string;
		sortBy?: string;
		hideDone?: boolean;
		hideDoneApplies: boolean;
		density?: Density;
		secondaryFiltersOpen?: boolean;
		densityTabs: Array<{ id: Density; label: string }>;
		energyDragTarget: string;
		packCount: number;
		onStatusFilterChange: (event: Event) => void | Promise<void>;
		onClearAllFilters: () => void | Promise<void>;
		onEnergyDragOver: (event: DragEvent, energy: string) => void;
		onEnergyDragLeave: (energy: string) => void;
		onEnergyDrop: (event: DragEvent, energy: string) => void | Promise<void>;
		onDensityChange: (id: string) => void;
		onInteraction?: () => void;
	} = $props();

	const ENERGY_FILTERS: Array<[string, string]> = [
		['all', 'All energy'],
		...ENERGY_OPTIONS.map(({ value, label }) => [value, label] as [string, string])
	];

	let uniqueAreas = $derived(workMetadata.uniqueAreas);
	let uniqueRecurrences = $derived(workMetadata.uniqueRecurrences);
	let uniqueOwners = $derived(workMetadata.uniqueOwners);
	let countByEnergy = $derived(workMetadata.countByEnergy);
	let countByArea = $derived(workMetadata.countByArea);
	let countByRecurrence = $derived(workMetadata.countByRecurrence);
	let countByOwner = $derived(workMetadata.countByOwner);
	let countByDueUrgency = $derived(workMetadata.countByDueUrgency);
	let hasDoneWork = $derived(workMetadata.hasDoneWork);
	let activeSecondaryFilterCount = $derived(
		Number(energyFilter !== 'all') +
		Number(areaFilter !== 'all') +
		Number(recurrenceFilter !== 'all') +
		Number(ownerFilter !== 'all') +
		Number(dueUrgencyFilter !== 'all') +
		Number(hideDoneApplies) +
		Number(sortBy !== 'urgency')
	);
	let secondaryFilterSummary = $derived(
		activeSecondaryFilterCount > 0
			? `More filters (${activeSecondaryFilterCount} active)`
			: 'More filters'
	);

	function recurrenceLabel(value: string): string {
		return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
	}

	function setHumanWorkSearch(nextQuery: string) {
		query = nextQuery.slice(0, WORK_SEARCH_MAX_LENGTH);
	}
	function observeFilterInteraction(node: HTMLElement) {
		const notify = () => onInteraction?.();
		const events = ['pointerdown', 'keydown', 'input', 'change'];
		for (const event of events) node.addEventListener(event, notify, true);
		return { destroy() { for (const event of events) node.removeEventListener(event, notify, true); } };
	}
</script>

<div class="work-filter-stack" use:observeFilterInteraction>
	<WornToolbar label="Primary work filters">
		<WornSelect
			id="filter-status"
			aria-label="Filter by status"
			value={filter}
			options={statusFilterOptions}
			onchange={onStatusFilterChange}
		/>
		<WornInput
			type="search"
			class="demo-search-input"
			placeholder="Search…"
			aria-label="Filter work items by text"
			maxlength={WORK_SEARCH_MAX_LENGTH}
			bind:value={query}
			oninput={() => setHumanWorkSearch(query)}
		/>
	</WornToolbar>
	<WornCollapsible summary={secondaryFilterSummary} ariaLabel="Additional work filters" bind:open={secondaryFiltersOpen}>
		<WornToolbar label="Secondary work filters" variant="chips">
			{#if filter === 'all' && hasDoneWork}
				<WornChip size="sm" label="Hide done" pressed={hideDone} onclick={() => (hideDone = !hideDone)} />
			{/if}
			{#each ENERGY_FILTERS as [key, label] (key)}
				<WornChip size="sm" {label} count={countByEnergy[key] ?? 0} pressed={energyFilter === key} dragOver={energyDragTarget === key} ondragover={(event) => onEnergyDragOver(event, key)} ondragleave={() => onEnergyDragLeave(key)} ondrop={(event) => onEnergyDrop(event, key)} onclick={() => (energyFilter = key)} />
			{/each}
			<WornSelect
				id="filter-area"
				aria-label="Filter by area"
				bind:value={areaFilter}
				options={[
					{ value: 'all', label: 'Area' },
					...uniqueAreas.map((area) => ({ value: area, label: `${area}${countByArea[area] ? ` (${countByArea[area]})` : ''}` })),
					...(uniqueAreas.length > 0 ? [{ value: '_none', label: `Unassigned${countByArea['_none'] ? ` (${countByArea['_none']})` : ''}` }] : [])
				]}
			/>
			<WornSelect
				id="filter-recurrence"
				aria-label="Filter by recurrence"
				bind:value={recurrenceFilter}
				options={[
					{ value: 'all', label: 'Repeat' },
					...uniqueRecurrences.filter((recurrence) => recurrence !== 'none').map((recurrence) => ({ value: recurrence, label: `${recurrenceLabel(recurrence)}${countByRecurrence[recurrence] ? ` (${countByRecurrence[recurrence]})` : ''}` }))
				]}
			/>
			<WornSelect
				id="filter-owner"
				aria-label="Filter by owner"
				bind:value={ownerFilter}
				options={[
					{ value: 'all', label: 'Owner' },
					...uniqueOwners.map((owner) => ({ value: owner, label: `${owner}${countByOwner[owner] ? ` (${countByOwner[owner]})` : ''}` })),
					...((countByOwner['_unassigned'] ?? 0) > 0 ? [{ value: '_unassigned', label: `Unassigned (${countByOwner['_unassigned']})` }] : [])
				]}
			/>
			<WornChip size="sm" label="Overdue" count={countByDueUrgency.overdue} pressed={dueUrgencyFilter === 'overdue'} variant={dueUrgencyFilter === 'overdue' ? 'danger' : 'default'} onclick={() => (dueUrgencyFilter = dueUrgencyFilter === 'overdue' ? 'all' : 'overdue')} />
			<WornSelect
				id="sort-work"
				aria-label="Sort work items"
				bind:value={sortBy}
				options={[
					{ value: 'urgency', label: 'Sort' },
					{ value: 'due', label: 'Due' },
					{ value: 'title', label: 'Title' },
					{ value: 'status', label: 'Status' },
					{ value: 'energy', label: 'Energy' },
					{ value: 'recent', label: 'Recent' },
					{ value: 'manual', label: 'Manual' }
				]}
			/>
			{#if packCount > 1}
				<WornTabs
					id="work-density"
					label="Work display density"
					tabs={densityTabs}
					bind:active={density}
					onchange={onDensityChange}
				/>
			{/if}
			{#if filter !== 'all' || energyFilter !== 'all' || query || areaFilter !== 'all' || recurrenceFilter !== 'all' || ownerFilter !== 'all' || dueUrgencyFilter !== 'all' || sortBy !== 'urgency' || hideDoneApplies}
				<WornChip size="sm" label="Clear" onclick={onClearAllFilters} />
			{/if}
		</WornToolbar>
	</WornCollapsible>
</div>

<style>
	.work-filter-stack {
		display: grid;
		gap: 8px;
		max-width: 100%;
		min-width: 0;
	}
	.work-filter-stack :global(.worn-toolbar[aria-label="Primary work filters"]) {
		display: grid;
		grid-template-columns: minmax(160px, 220px) minmax(0, 1fr);
		width: 100%;
	}
	/* Nebius controls keep their own borders; the group adds no second frame. */
	:global(:root[data-palette]) .work-filter-stack :global(.worn-toolbar[aria-label="Primary work filters"]) {
		--worn-toolbar-padding: 0;
		--worn-toolbar-compact-padding: 0;
		--worn-toolbar-background: transparent;
		--worn-toolbar-border: transparent;
		--worn-toolbar-active-border: transparent;
		--worn-toolbar-active-shadow: none;
	}
	.work-filter-stack :global(.worn-toolbar[aria-label="Primary work filters"] .worn-select),
	.work-filter-stack :global(.worn-toolbar[aria-label="Primary work filters"] .worn-input) {
		max-width: 100%;
		min-width: 0;
		width: 100%;
	}
	@media (max-width: 700px) {
		.work-filter-stack :global(.worn-toolbar[aria-label="Primary work filters"]) {
			grid-template-columns: minmax(0, 1fr);
		}
		.work-filter-stack :global(.worn-toolbar[aria-label="Primary work filters"] .worn-select),
		.work-filter-stack :global(.worn-toolbar[aria-label="Primary work filters"] .worn-input) {
			min-height: 44px;
		}
	}
	@media (max-width: 420px) {
		.work-filter-stack :global(.worn-toolbar[aria-label="Primary work filters"]) {
			display: grid;
			grid-template-columns: minmax(0, 1fr);
			--worn-toolbar-margin-block-end: 0;
		}
		.work-filter-stack :global(.worn-toolbar[aria-label="Secondary work filters"].is-chips) {
			grid-template-columns: minmax(0, 1fr);
			width: 100%;
		}
		.work-filter-stack :global(.worn-toolbar[aria-label="Secondary work filters"] .worn-chip),
		.work-filter-stack :global(.worn-toolbar[aria-label="Secondary work filters"] .worn-select),
		.work-filter-stack :global(.worn-toolbar[aria-label="Secondary work filters"] .worn-tabs) {
			max-width: 100%;
			min-width: 0;
			width: 100%;
		}
	}
	@media (pointer: coarse) {
		.work-filter-stack :global(.worn-toolbar[aria-label="Secondary work filters"] .worn-chip),
		.work-filter-stack :global(.worn-toolbar[aria-label="Secondary work filters"] .worn-tabs button) {
			min-height: 44px;
		}
	}
</style>
