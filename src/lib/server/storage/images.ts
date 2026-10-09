import sharp from 'sharp';

// Shared image helpers used by both meal photos and progress photos.
//
// The client-declared MIME type is untrusted — another account could upload HTML labeled image/png,
// which must never end up served from our origin — so format is always determined from magic bytes,
// and metadata (EXIF/XMP/IPTC/comments, including phone GPS coordinates) is stripped before storage.

export type ImageExt = 'jpg' | 'png' | 'webp';

const MIME_BY_EXT: Record<ImageExt, string> = {
	jpg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp'
};

export function mimeForExt(ext: ImageExt): string {
	return MIME_BY_EXT[ext];
}

/** Identifies the image format from its magic bytes, or null if it isn't one of our accepted formats. */
export function sniffImageExt(buf: Buffer): ImageExt | null {
	if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
	if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
		return 'png';
	if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP')
		return 'webp';
	return null;
}

/** Decode with bounded pixels, apply camera orientation to pixels, and encode without metadata.
 * Malformed inputs fail closed. Animated uploads use their first frame, like a still progress photo. */
export async function stripImageMetadata(buf: Buffer, ext: ImageExt): Promise<Buffer> {
	try {
		return await sharp(buf, { failOn: 'warning', limitInputPixels: 40_000_000 })
			.rotate()
			.toFormat(ext === 'jpg' ? 'jpeg' : ext)
			.toBuffer();
	} catch {
		throw new Error('Photo could not be processed. Use a valid JPEG, PNG, or WebP image.');
	}
}
