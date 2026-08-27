// Orchestrates the AI Workout Coach: gathers a logged session's sets, each exercise's recent history/
// PRs, the user's declared goals, and this week's muscle-group volume — all from existing repositories —
// then asks Sonnet for a progressive-overload + muscle-balance suggestion. Cached per session, with a
// short cooldown since a user may log more sets mid-session and want updated numbers.

import { generateText, AI_MODEL_SONNET } from './client';
import { getCached, save, type CoachInsight } from '$lib/server/repositories/workoutCoachInsights';
import { getSessionWithSets } from '$lib/server/repositories/workouts';
import { getExerciseProgress, weeklySetsByMuscleGroup } from '$lib/server/repositories/progress';
import { goalsByExercise } from '$lib/server/repositories/exerciseGoals';
import { muscleGroupOrder } from '$lib/muscleGroups';
import { shiftIsoDate } from '$lib/utils/isoDate';

const REGENERATE_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

const SYSTEM_PROMPT = `You are an experienced strength & conditioning coach reviewing a client's logged training data. You'll receive: the exercises and sets logged in today's session (weight, reps, RPE), each exercise's recent history and estimated 1RM trend, the client's own stated targets for exercises that have one, and this week's total sets performed per muscle group. For each exercise logged today, give one concise, specific progressive-overload recommendation for their *next* session on that exercise — a concrete weight/rep target, or a deload suggestion if the RPE/fatigue trend warrants it — grounded only in the numbers given. Then note any muscle group that looks under-trained relative to the others this week, using only the set counts provided, and briefly say why it's worth addressing. Write in a direct, encouraging coach voice, plain prose, no headers or bullet lists, roughly 150–250 words. Never reference an exercise, weight, or date that isn't in the data you were given.`;

type Result = { insight: CoachInsight; fromCache: boolean } | { error: string };

export async function generateCoachInsight(userId: number, sessionId: number): Promise<Result> {
	const cached = await getCached(userId, sessionId);
	if (cached && Date.now() - cached.generatedAt.getTime() < REGENERATE_COOLDOWN_MS) {
		return { insight: cached, fromCache: true };
	}

	const result = await getSessionWithSets(userId, sessionId);
	if (!result) return { error: 'Workout session not found' };

	const [progressByExercise, goals, muscleSets] = await Promise.all([
		Promise.all(result.exerciseGroups.map((g) => getExerciseProgress(userId, g.exerciseId))),
		goalsByExercise(userId),
		weeklySetsByMuscleGroup(userId, shiftIsoDate(result.session.date, -6), result.session.date)
	]);

	const exercises = result.exerciseGroups.map((group, i) => {
		const progress = progressByExercise[i];
		const goal = goals[group.exerciseId] ?? null;
		return {
			name: group.exerciseName,
			todaySets: group.sets.map((s) => ({ reps: s.reps, weight: s.weight })),
			recentHistory: (progress?.history ?? [])
				.filter((h) => h.date < result.session.date)
				.slice(-5)
				.map((h) => ({ date: h.date, topWeight: h.topWeight, bestOneRm: Math.round(h.bestOneRm) })),
			goal: goal ? { targetWeight: goal.targetWeight, targetReps: goal.targetReps } : null
		};
	});

	const muscleGroupSets = muscleSets
		.map((m) => ({ label: m.muscleGroup ?? 'Other', sets: m.sets }))
		.sort((a, b) => muscleGroupOrder(a.label) - muscleGroupOrder(b.label));

	const input = { sessionDate: result.session.date, exercises, muscleGroupSets };

	const aiResult = await generateText({
		model: AI_MODEL_SONNET,
		system: SYSTEM_PROMPT,
		prompt: JSON.stringify(input),
		maxTokens: 768
	});
	if (!aiResult) return { error: 'AI is not configured or the request failed. Try again later.' };

	const insight = await save(userId, sessionId, aiResult.text.trim(), aiResult.model);
	return { insight, fromCache: false };
}
