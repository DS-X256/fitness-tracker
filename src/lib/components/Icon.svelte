<script lang="ts">
	type IconName =
		| 'home'
		| 'meals'
		| 'cart'
		| 'dumbbell'
		| 'plus'
		| 'minus'
		| 'trash'
		| 'check'
		| 'chevron-right'
		| 'chevron-left'
		| 'search'
		| 'x'
		| 'edit'
		| 'chart'
		| 'star'
		| 'logout'
		| 'tag'
		| 'list'
		| 'sliders'
		| 'scan'
		| 'target'
		| 'camera'
		| 'scale'
		| 'health'
		| 'vial'
		| 'calendar'
		| 'clock'
		| 'alert'
		| 'users'
		| 'move-horizontal';

	let { name, size = 22, class: className = '' }: { name: IconName; size?: number; class?: string } =
		$props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	class={className}
	aria-hidden="true"
>
	{#if name === 'home'}
		<path d="M4 11.5 12 4l8 7.5" />
		<path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9" />
		<path d="M10 20v-6h4v6" />
	{:else if name === 'meals'}
		<path d="M7 3v7a2 2 0 0 0 2 2v9" />
		<path d="M7 3v5M9.5 3v5" />
		<path d="M17 3c-1.5 0-2.5 1.8-2.5 4.5S15.5 11 17 11v10" />
	{:else if name === 'cart'}
		<circle cx="9" cy="20" r="1.5" />
		<circle cx="18" cy="20" r="1.5" />
		<path d="M2.5 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.6L21 7H6" />
	{:else if name === 'dumbbell'}
		<path d="M4 9v6M2.5 10.5v3" />
		<path d="M20 9v6M21.5 10.5v3" />
		<path d="M7 12h10" />
		<rect x="5" y="8" width="4" height="8" rx="1" />
		<rect x="15" y="8" width="4" height="8" rx="1" />
	{:else if name === 'plus'}
		<path d="M12 5v14M5 12h14" />
	{:else if name === 'minus'}
		<path d="M5 12h14" />
	{:else if name === 'trash'}
		<path d="M4 7h16" />
		<path d="M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7" />
		<path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
	{:else if name === 'check'}
		<path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
	{:else if name === 'chevron-right'}
		<path d="M9 5l7 7-7 7" />
	{:else if name === 'chevron-left'}
		<path d="M15 5l-7 7 7 7" />
	{:else if name === 'search'}
		<circle cx="11" cy="11" r="6.5" />
		<path d="M20 20l-4.5-4.5" />
	{:else if name === 'x'}
		<path d="M6 6l12 12M18 6L6 18" />
	{:else if name === 'edit'}
		<path d="M4 20h4L19 9a2.4 2.4 0 0 0-4-4L4 16v4" />
		<path d="M13.5 6.5l4 4" />
	{:else if name === 'chart'}
		<path d="M4 20V10M11 20V4M18 20v-7" />
	{:else if name === 'star'}
		<path
			d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9L12 3.5Z"
		/>
	{:else if name === 'logout'}
		<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
		<path d="M16 16l4-4-4-4M20 12H9" />
	{:else if name === 'tag'}
		<path d="M4 4h7l9 9-7 7-9-9V4Z" />
		<circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" />
	{:else if name === 'list'}
		<path d="M9 6h11M9 12h11M9 18h11" />
		<path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
	{:else if name === 'sliders'}
		<path d="M4 21v-7M1 14h6M4 10V3" />
		<path d="M12 21v-9M9 8h6M12 8V3" />
		<path d="M20 21v-5M17 16h6M20 12V3" />
	{:else if name === 'scan'}
		<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
		<path d="M8 8v8M12 8v8M16 8v8" />
	{:else if name === 'target'}
		<circle cx="12" cy="12" r="8.5" />
		<circle cx="12" cy="12" r="4.5" />
		<circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
	{:else if name === 'camera'}
		<path d="M4 8h3l1.6-2.2a1 1 0 0 1 .8-.4h5.2a1 1 0 0 1 .8.4L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
		<circle cx="12" cy="13.5" r="3.4" />
	{:else if name === 'scale'}
		<rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
		<path d="M8.5 9.5a3.5 3.5 0 0 1 7 0" />
		<path d="M12 9.5l2.2-1.3" />
	{:else if name === 'health'}
		<rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
		<path d="M12 8.5v7M8.5 12h7" />
	{:else if name === 'vial'}
		<path d="M9 3h6" />
		<path d="M10 3v13a2 2 0 0 0 4 0V3" />
		<path d="M10 9.5h4" />
	{:else if name === 'calendar'}
		<rect x="3.5" y="5" width="17" height="15" rx="2.5" />
		<path d="M3.5 9.5h17" />
		<path d="M8 3v4M16 3v4" />
	{:else if name === 'clock'}
		<circle cx="12" cy="12" r="8.5" />
		<path d="M12 7.5V12l3 2" />
	{:else if name === 'alert'}
		<path d="M12 4 2.5 20h19L12 4Z" />
		<path d="M12 10v4" />
		<path d="M12 17h.01" />
	{:else if name === 'users'}
		<circle cx="8.5" cy="8" r="3.3" />
		<path d="M2.5 19.5c0-3.3 2.7-5.8 6-5.8s6 2.5 6 5.8" />
		<path d="M15.5 5.3a3.3 3.3 0 0 1 0 6.4" />
		<path d="M17 13.8c2.6.5 4.5 2.6 4.5 5.7" />
	{:else if name === 'move-horizontal'}
		<path d="M18 8l4 4-4 4" />
		<path d="M6 8l-4 4 4 4" />
		<path d="M2 12h20" />
	{/if}
</svg>
