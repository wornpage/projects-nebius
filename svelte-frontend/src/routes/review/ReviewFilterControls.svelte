<script lang="ts">
	import { WornInput, WornSegmentedControl, WornToolbar } from '$lib/components';
	import { REVIEW_SEARCH_MAX_LENGTH } from './review-webmcp.mjs';
	import type { ReviewSubFilter } from './review-queue';

	interface Props {
		options: Array<{ id: ReviewSubFilter; label: string }>;
		query: string;
		active: ReviewSubFilter;
	}

	let {
		options,
		query = $bindable(),
		active = $bindable()
	}: Props = $props();

	function setHumanReviewQuery(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const nextQuery = input.value.slice(0, REVIEW_SEARCH_MAX_LENGTH);
		input.value = nextQuery;
		query = nextQuery;
	}
</script>

<WornToolbar label="Review filters">
	<div class="review-filter-controls" data-review-filter-controls>
		<WornSegmentedControl
			{options}
			bind:active
			name="review-subfilter"
			label="Review queue filter"
		/>
		<WornInput
			id="review-filter-query"
			type="search"
			maxlength={REVIEW_SEARCH_MAX_LENGTH}
			placeholder="Search review…"
			aria-label="Filter review items by text"
			bind:value={query}
			oninput={setHumanReviewQuery}
		/>
	</div>
</WornToolbar>

<style>
	.review-filter-controls{display:grid;gap:8px;grid-template-columns:minmax(0,1fr) minmax(200px,.7fr);min-width:0;width:100%}
	@media(max-width:500px){.review-filter-controls{grid-template-columns:minmax(0,1fr)}}
</style>
