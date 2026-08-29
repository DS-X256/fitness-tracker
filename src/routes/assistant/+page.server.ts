import { fail } from '@sveltejs/kit';
import { aiAvailable } from '$lib/server/ai/client';
import { getOrCreateActiveThread, listMessages, clearThread } from '$lib/server/repositories/assistant';
import { getSettings, updateSettings } from '$lib/server/repositories/userSettings';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const [settings, threadId] = await Promise.all([getSettings(userId), getOrCreateActiveThread(userId)]);
	const messages = settings.aiAssistantEnabled ? await listMessages(userId, threadId) : [];
	return {
		messages,
		aiAvailable: aiAvailable(),
		assistantEnabled: settings.aiAssistantEnabled
	};
};

export const actions: Actions = {
	toggleAssistant: async ({ request, locals }) => {
		const enabled = String((await request.formData()).get('enabled') ?? '') === 'true';
		await updateSettings(locals.user!.id, { aiAssistantEnabled: enabled });
		return { success: true };
	},

	clearChat: async ({ locals }) => {
		const userId = locals.user!.id;
		const threadId = await getOrCreateActiveThread(userId);
		await clearThread(userId, threadId);
		return { success: true };
	}
};
