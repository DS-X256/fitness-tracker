/** Canonical logged sets: whole repetitions, nonnegative kg (zero permits bodyweight), optional RPE. */
export function validateWorkoutSet(data: { reps: number; weight: number; rpe?: number | null }): void {
	if (!Number.isSafeInteger(data.reps) || data.reps <= 0) throw new Error('Repetitions must be a positive whole number');
	if (!Number.isFinite(data.weight) || data.weight < 0) throw new Error('Weight must be a nonnegative number');
	if (data.rpe != null && (!Number.isFinite(data.rpe) || data.rpe < 1 || data.rpe > 10)) {
		throw new Error('RPE must be between 1 and 10');
	}
}
