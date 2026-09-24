import type { ParamMatcher } from '@sveltejs/kit';

/** A positive integer id segment — keeps `/peptides/[id]` from shadowing words like /peptides/levels. */
export const match: ParamMatcher = (param) => /^[1-9]\d*$/.test(param);
