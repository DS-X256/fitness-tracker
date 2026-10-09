import { it, expect } from 'vitest';
import sharp from 'sharp';
import { stripImageMetadata } from '../src/lib/server/storage/images';

for (const ext of ['jpg', 'png', 'webp'] as const) {
	it(`strips ${ext} metadata and preserves oriented dimensions`, async () => {
		const input = await sharp({ create: { width: 3, height: 7, channels: 3, background: 'red' } })
			.withMetadata({ orientation: 6 }).withExifMerge({ IFD0: { Artist: 'PRIVATE-METADATA' } })
			.toFormat(ext === 'jpg' ? 'jpeg' : ext).toBuffer();
		const clean = await stripImageMetadata(input, ext);
		const metadata = await sharp(clean).metadata();
		expect(clean.includes(Buffer.from('PRIVATE-METADATA'))).toBe(false);
		expect(metadata.exif).toBeUndefined();
		expect(metadata.xmp).toBeUndefined();
		expect([metadata.width, metadata.height]).toEqual([7, 3]);
	});
}
it('rejects malformed images instead of retaining the original bytes', async () => {
	await expect(stripImageMetadata(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 50, 1]), 'jpg')).rejects.toThrow('could not be processed');
	await expect(stripImageMetadata(Buffer.from('RIFFxxxxWEBPprivate'), 'webp')).rejects.toThrow();
});
