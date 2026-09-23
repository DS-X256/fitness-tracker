// The fields DoseHistoryList renders — any richer dose view-model (dashboard/hub DoseRow) satisfies it.
import type { ApplicationSite, DoseEffect, DoseKind } from '$lib/utils/peptides';

export type HistoryRow = {
	id: number;
	peptideId: number;
	peptideName: string;
	date: string;
	time: string | null;
	doseMcg: number;
	site: ApplicationSite | null;
	kind: DoseKind;
	effects: DoseEffect[];
	split: { peptideId: number | null; name: string; mcg: number }[] | null;
	splitEstimated: boolean;
};
