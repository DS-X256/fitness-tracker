<script lang="ts">
	import './layout.css';
	import { page } from '$app/state';
	import { browser, dev } from '$app/environment';
	import BottomNav from '$lib/components/BottomNav.svelte';

	let { children } = $props();

	const showChrome = $derived(page.url.pathname !== '/login');
	// The assistant is a full-height chat: it owns the space between header and bottom nav and manages
	// its own scrolling, so main becomes a flex column and drops the usual bottom-nav padding.
	const isAssistant = $derived(page.url.pathname === '/assistant');

	if (browser && !dev && 'serviceWorker' in navigator) {
		navigator.serviceWorker.register('/service-worker.js');
	}
</script>

<svelte:head>
	<link rel="icon" href="/icons/favicon-32.png" sizes="32x32" />
	<link rel="icon" href="/icons/icon-192.png" sizes="192x192" />
</svelte:head>

<div class={`flex flex-col ${isAssistant ? 'h-dvh' : 'min-h-dvh'}`}>
	<main class={`flex-1 min-h-0 ${isAssistant ? 'flex flex-col' : showChrome ? 'pb-24' : ''}`}>
		{@render children()}
	</main>
	{#if showChrome}
		<BottomNav />
	{/if}
</div>
