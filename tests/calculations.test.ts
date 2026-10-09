import { describe, it, expect } from 'vitest';
import { projectRunout, type SupplyProtocol } from '../src/lib/utils/peptideSupply';
import { exactWholeUnits } from '../src/lib/utils/delivery';
import { validateWorkoutSet } from '../src/lib/utils/workoutValidation';
const today = '2026-10-09';
const protocol: SupplyProtocol = { frequency: 'daily', startDate: today, doseMcg: 100 };

describe('Shared container supply', () => {
	it('counts only each protocol’s own pending consumption', () => {
		expect(projectRunout(150, [protocol, protocol], today, { pendingTodaySlotsByProtocol: [0, 1] }).runsOutOn).toBe('2026-10-10');
	});
	it('preserves mixed doses and multiple slots', () => {
		expect(projectRunout(450, [{ ...protocol, timesPerDay: 2 }, { ...protocol, doseMcg: 300 }], today, { pendingTodaySlotsByProtocol: [1, 0] }).runsOutOn).toBe('2026-10-10');
	});
	it('uses flexible weekly rates and loading/taper targets', () => {
		expect(projectRunout(300, [{ ...protocol, frequency: 'x_per_week', perWeek: 7 }], today).daysLeft).toBe(3);
		expect(projectRunout(400, [{ ...protocol, loadingDoseMcg: 200, loadingDurationDays: 2 }], today).daysLeft).toBe(2);
	});
});

it('never rounds a quick-log quantity to whole units', () => {
	expect(exactWholeUnits(300, 200)).toBeNull();
	expect(exactWholeUnits(100, 200)).toBeNull();
	expect(exactWholeUnits(400, 200)).toBe(2);
	expect(exactWholeUnits(0.3, 0.1)).toBe(3);
	expect(exactWholeUnits(500, 0)).toBeNull();
});

it('allows bodyweight sets and rejects invalid recorded values', () => {
	expect(() => validateWorkoutSet({ reps: 5, weight: 0, rpe: 7.5 })).not.toThrow();
	for (const invalid of [{ reps: -5, weight: 20 }, { reps: 1.5, weight: 20 }, { reps: 5, weight: -20 }, { reps: 5, weight: NaN }, { reps: 5, weight: 20, rpe: NaN }, { reps: 5, weight: 20, rpe: 11 }]) {
		expect(() => validateWorkoutSet(invalid)).toThrow();
	}
});
