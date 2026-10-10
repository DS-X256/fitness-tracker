import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const index = `# Peptide Profiles
- [BPC-157](https://peptpedia.org/peptide/bpc-157): profile
- [CJC-1295](https://peptpedia.org/peptide/cjc-1295): with DAC
- [Mod GRF 1-29](https://peptpedia.org/peptide/mod-grf-1-29): without DAC
- [Epithalon](https://peptpedia.org/peptide/epithalon): profile
- [Untrusted](https://example.com/peptide/unknown): ignored
`;
const textResponse = (text: string) => new Response(text, { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
	vi.resetModules();
	fetchMock.mockReset();
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

async function lookup() { return (await import('../src/lib/server/ai/peptpedia')).lookupPeptpedia; }

describe('Peptpedia live lookup', () => {
	it('fetches official markdown and returns a clickable source without sending search or personal data', async () => {
		fetchMock.mockResolvedValueOnce(textResponse(index)).mockResolvedValueOnce(textResponse('# BPC-157\nStudy PMID 12345678'));
		const result = await (await lookup())('BPC 157');
		expect(result).toMatchObject({ status: 'ok', source: 'Peptpedia', url: 'https://peptpedia.org/peptide/bpc-157', markdown: '# BPC-157\nStudy PMID 12345678', truncated: false });
		expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['https://peptpedia.org/llms.txt', 'https://peptpedia.org/peptide/bpc-157.md']);
		expect(fetchMock.mock.calls[1][1]).toMatchObject({ redirect: 'error' });
	});

	it('keeps CJC with DAC and no DAC on different profiles and resolves spelling aliases', async () => {
		fetchMock.mockImplementation(async (url) => textResponse(String(url).endsWith('/llms.txt') ? index : '# Profile'));
		const get = await lookup();
		expect((await get('CJC-1295 (no DAC)')).url).toBe('https://peptpedia.org/peptide/mod-grf-1-29');
		expect((await get('CJC-1295 (with DAC)')).url).toBe('https://peptpedia.org/peptide/cjc-1295');
		expect((await get('Epitalon')).url).toBe('https://peptpedia.org/peptide/epithalon');
	});

	it('does not guess a profile or fetch user-provided URLs', async () => {
		fetchMock.mockResolvedValue(textResponse(index));
		const get = await lookup();
		for (const name of ['BPC', 'KLOW', 'https://example.com/peptide/unknown']) {
			expect((await get(name)).status).toBe('not-found');
		}
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect((await get('')).status).toBe('error');
		expect((await get('x'.repeat(121))).status).toBe('error');
	});

	it('caches successful results for six hours and refreshes after expiry', async () => {
		vi.useFakeTimers();
		fetchMock.mockImplementation(async (url) => textResponse(String(url).endsWith('/llms.txt') ? index : '# Profile'));
		const get = await lookup();
		await get('BPC-157');
		await get('BPC 157');
		expect(fetchMock).toHaveBeenCalledTimes(2);
		vi.advanceTimersByTime(6 * 60 * 60 * 1000 + 1);
		await get('BPC-157');
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it('reports outages and timeouts explicitly, and retries failed profiles', async () => {
		fetchMock.mockResolvedValueOnce(textResponse(index))
			.mockResolvedValueOnce(new Response('Unavailable', { status: 503 }))
			.mockRejectedValueOnce(new DOMException('Timed out', 'TimeoutError'))
			.mockResolvedValueOnce(textResponse('# Recovered'));
		const get = await lookup();
		expect((await get('BPC-157')).status).toBe('error');
		expect((await get('BPC-157')).status).toBe('timeout');
		expect((await get('BPC-157')).status).toBe('ok');
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it('rejects HTML error pages and oversized responses, and marks truncated reference content', async () => {
		fetchMock.mockResolvedValueOnce(textResponse(index))
			.mockResolvedValueOnce(new Response('<html>Error</html>', { headers: { 'content-type': 'text/html' } }))
			.mockResolvedValueOnce(textResponse('x'.repeat(256_001)))
			.mockResolvedValueOnce(textResponse('x'.repeat(40_001)));
		const get = await lookup();
		expect((await get('BPC-157')).status).toBe('error');
		expect((await get('BPC-157')).status).toBe('error');
		const result = await get('BPC-157');
		expect(result.truncated).toBe(true);
		expect(result.markdown).toHaveLength(40_000);
	});

	it('is exposed in the chat research tools and leaves primary-evidence failure visible', async () => {
		fetchMock.mockImplementation(async (url) => {
			if (url === 'https://peptpedia.org/llms.txt') return textResponse(index);
			if (url === 'https://peptpedia.org/peptide/bpc-157.md') return textResponse('# BPC-157');
			return new Response('Unavailable', { status: 503 });
		});
		const { RESEARCH_TOOLS, runResearchTool, researchToolLabel } = await import('../src/lib/server/ai/peptideResearch');
		expect(RESEARCH_TOOLS.some((t) => t.name === 'lookup_peptpedia')).toBe(true);
		expect(researchToolLabel('lookup_peptpedia')).toContain('Peptpedia');
		expect(JSON.parse(await runResearchTool('lookup_peptpedia', { compound: 'BPC-157' })).status).toBe('ok');
		const bundle = JSON.parse(await runResearchTool('research_peptide', { compound: 'BPC-157' }));
		expect(bundle.peptpedia.status).toBe('ok');
		expect(bundle.sourcesQueried).toEqual({ pubmed: 'error', clinicalTrials: 'error', peptpedia: 'ok' });
		expect(bundle.evidenceTier).toBe('lookup-failed');
	});
});
