import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { todayIso } from '../src/lib/utils/todayIso';
import { shiftIsoDate } from '../src/lib/utils/isoDate';

const dir = mkdtempSync(path.join(tmpdir(), 'fitness-dashboard-'));
process.env.DATABASE_URL = path.join(dir, 'test.db');
let db: typeof import('../src/lib/server/db').db;
let workouts: typeof import('../src/lib/server/repositories/workouts');
let body: typeof import('../src/lib/server/repositories/bodyMetrics');
let goals: typeof import('../src/lib/server/repositories/weightGoals');
const today = todayIso();
const weekFrom = shiftIsoDate(today, -6);
let sessionIds: number[];
beforeAll(async () => {
	execFileSync(process.execPath, ['scripts/migrate.js'], { env: process.env });
	({ db } = await import('../src/lib/server/db'));
	workouts = await import('../src/lib/server/repositories/workouts');
	body = await import('../src/lib/server/repositories/bodyMetrics');
	goals = await import('../src/lib/server/repositories/weightGoals');
	const sql = db.$client;
	sql.prepare('INSERT INTO users(id,username,password_hash) VALUES (1,?,?), (2,?,?), (3,?,?)').run('owner', 'fixture', 'other', 'fixture', 'empty', 'fixture');
	const addSession = sql.prepare('INSERT INTO workout_sessions(user_id,date,created_at) VALUES (?,?,?)');
	sessionIds = [-7, -6, -3, 0, 0, 1].map((offset, n) => Number(addSession.run(1, shiftIsoDate(today, offset), 1000 + n).lastInsertRowid));
	addSession.run(2, today, 2000);
	const exerciseId = Number(sql.prepare('INSERT INTO exercises(user_id,name) VALUES (1,?)').run('Fixture').lastInsertRowid);
	const addSet = sql.prepare('INSERT INTO workout_sets(session_id,exercise_id,reps,weight) VALUES (?,?,5,20)');
	addSet.run(sessionIds[1], exerciseId);
	addSet.run(sessionIds[1], exerciseId);
	addSet.run(sessionIds[4], exerciseId);
	for (const [offset, weightKg] of [[-200, 100], [-181, 98], [-180, 96], [-179, 94], [-174, 92], [-30, 90], [-7, 88], [0, 86]]) {
		await body.logBodyMetrics(1, shiftIsoDate(today, offset), { weightKg });
	}
	await body.logBodyMetrics(1, shiftIsoDate(today, -4), { waistCm: 80 });
	await body.logBodyMetrics(2, today, { weightKg: 222 });
	await goals.upsertWeightGoal(1, 80, null);
	await goals.upsertWeightGoal(3, 80, null);
});
afterAll(() => {
	db?.$client.close();
	rmSync(dir, { recursive: true, force: true });
});
it('bounds dashboard workouts inclusively while preserving counts, order and ownership', async () => {
	const all = await workouts.listSessions(1);
	const bounded = await workouts.listSessions(1, { from: weekFrom, to: today });
	expect(bounded).toEqual(all.filter((s) => s.date >= weekFrom && s.date <= today));
	expect(bounded.map((s) => s.id)).toEqual([sessionIds[4], sessionIds[3], sessionIds[2], sessionIds[1]]);
	expect(bounded.map((s) => [s.setCount, s.exerciseCount])).toEqual([[1, 1], [0, 0], [0, 0], [2, 1]]);
	expect(await workouts.listSessions(3, { from: weekFrom, to: today })).toEqual([]);
});
it('limits recent workouts without limiting the full workout-history page', async () => {
	const all = await workouts.listSessions(1);
	expect(all).toHaveLength(6);
	expect(await workouts.listSessions(1, { limit: 2 })).toEqual(all.slice(0, 2));
	expect(await workouts.listSessions(1, { limit: 0 })).toEqual([]);
	expect(await workouts.listSessions(1, { from: today, to: today, limit: 1 })).toEqual([all.find((s) => s.id === sessionIds[4])]);
});
it('uses one weight-history read for lifetime stats and a bounded chart with its original smoothing boundary', async () => {
	const prepare = vi.spyOn(db.$client, 'prepare');
	const overview = await body.weightOverview(1, { days: 180 });
	expect(prepare).toHaveBeenCalledTimes(1);
	prepare.mockRestore();
	expect(overview.stats).toEqual({ weightKg: 86, date: today, change7: -2, change30: -4, weeklyRateKg: -0.93, count: 8 });
	expect(overview.trend.map((p) => p.weightKg)).toEqual([96, 94, 92, 90, 88, 86]);
	expect(overview.trend.map((p) => p.avgKg)).toEqual([96, 95, 94, 93, 92, 91]);
	expect(overview.stats).toEqual(await body.weightStats(1));
	expect(overview.trend).toEqual(await body.weightTrend(1, { days: 180 }));
	expect((await body.weightOverview(2)).stats?.weightKg).toBe(222);
});
it('reuses existing weight stats for goal progress without another history query', async () => {
	const overview = await body.weightOverview(1, { days: 90 });
	const prepare = vi.spyOn(db.$client, 'prepare');
	const goal = await goals.goalProgress(1, overview.stats);
	expect(prepare).toHaveBeenCalledTimes(1);
	prepare.mockRestore();
	expect(goal).toEqual({ targetWeightKg: 80, targetDate: null, currentKg: 86, remainingKg: -6, progress: 0.4, achieved: false, etaWeeks: 6.5 });
	expect(goal).toEqual(await goals.goalProgress(1));
});
it('handles empty history and passes null stats through without reading history again', async () => {
	const overview = await body.weightOverview(3, { days: 180 });
	expect(overview).toEqual({ stats: null, trend: [] });
	const prepare = vi.spyOn(db.$client, 'prepare');
	const goal = await goals.goalProgress(3, overview.stats);
	expect(prepare).toHaveBeenCalledTimes(1);
	prepare.mockRestore();
	expect(goal?.currentKg).toBeNull();
	expect(goal?.achieved).toBe(false);
	expect(await goals.goalProgress(2, (await body.weightOverview(2)).stats)).toBeNull();
});
it('returns fresh overview data after weight edits', async () => {
	await body.logBodyMetrics(2, today, { weightKg: 220 });
	const overview = await body.weightOverview(2);
	expect(overview.stats?.weightKg).toBe(220);
	expect(overview.trend).toEqual([{ date: today, weightKg: 220, avgKg: 220 }]);
	expect((await body.weightOverview(1)).stats?.weightKg).toBe(86);
});
