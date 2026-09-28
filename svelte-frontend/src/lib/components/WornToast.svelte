<script lang="ts">
	import { Toast } from '@wornpage/toast';
	import type { DemoToast } from '$lib/demo-client';

	interface Props {
		toast: DemoToast;
		ondismiss: () => void;
	}

	let { toast, ondismiss }: Props = $props();
</script>

<Toast
	message={toast.message}
	kind={toast.kind ?? 'info'}
	dismissLabel={`Dismiss notification: ${toast.message}`}
	{ondismiss}
/>
