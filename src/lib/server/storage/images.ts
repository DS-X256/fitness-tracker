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

/** Removes metadata segments/chunks (EXIF GPS, XMP, IPTC, thumbnails, comments) while preserving the
 *  actual image data. Pure-JS, format-aware, no dependency. On anything unexpected it returns the input
 *  unchanged rather than risk corrupting the image — the magic-byte sniff already gates what gets here,
 *  and callers re-sniff the result.
 *
 *  One deliberate exception to "strip everything": the Exif Orientation tag. Phone cameras write pixel
 *  data in the sensor's native (often landscape) layout and rely on this tag to say "rotate/flip before
 *  displaying" — dropping it along with the rest of Exif doesn't just lose metadata, it visibly changes
 *  the photo (a portrait shot renders sideways). So JPEG/WebP Exif is rewritten down to a synthetic
 *  segment containing ONLY that one tag (no GPS, camera make/model, timestamps, thumbnail — nothing
 *  else survives) rather than dropped outright. */
export function stripImageMetadata(buf: Buffer, ext: ImageExt): Buffer {
	try {
		if (ext === 'jpg') return stripJpeg(buf);
		if (ext === 'png') return stripPng(buf);
		if (ext === 'webp') return stripWebp(buf);
	} catch {
		// fall through — never throw from metadata stripping
	}
	return buf;
}

// --- Exif orientation (shared by JPEG's APP1 and WebP's EXIF chunk) ---------
const EXIF_SIG = Buffer.from('Exif\0\0', 'latin1');

/** Reads the Orientation tag (1–8) out of a chunk of Exif-formatted data — a raw TIFF blob, optionally
 *  prefixed with the legacy "Exif\0\0" signature (JPEG APP1 carries the prefix; WebP's EXIF chunk and
 *  PNG's eXIf chunk don't). Returns null on anything missing, malformed, or out of range — callers treat
 *  that as "no orientation to preserve" and drop the metadata entirely, same as before this existed. */
function readExifOrientation(buf: Buffer): number | null {
	try {
		const tiff = buf.length >= 6 && buf.subarray(0, 6).equals(EXIF_SIG) ? buf.subarray(6) : buf;
		if (tiff.length < 8) return null;
		const bom = tiff.subarray(0, 2).toString('latin1');
		let le: boolean;
		if (bom === 'II') le = true;
		else if (bom === 'MM') le = false;
		else return null;
		const u16 = (o: number) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
		const u32 = (o: number) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
		if (u16(2) !== 42) return null;
		const ifd0 = u32(4);
		if (ifd0 + 2 > tiff.length) return null;
		const count = u16(ifd0);
		if (count > 1000) return null; // sane upper bound — real files have a handful of tags
		for (let e = 0; e < count; e++) {
			const entryOff = ifd0 + 2 + e * 12;
			if (entryOff + 12 > tiff.length) break;
			if (u16(entryOff) !== 0x0112) continue; // 0x0112 = Orientation
			if (u16(entryOff + 2) !== 3) return null; // not a SHORT — malformed, don't guess
			const value = u16(entryOff + 8); // values ≤4 bytes sit left-justified in the value field
			return value >= 1 && value <= 8 ? value : null;
		}
		return null;
	} catch {
		return null;
	}
}

/** Builds a minimal little-endian TIFF blob containing a single Orientation entry and nothing else —
 *  no "Exif\0\0" prefix (WebP's EXIF chunk and PNG's eXIf chunk don't carry one; JPEG's APP1 caller adds
 *  it separately). 26 bytes: 8-byte TIFF header + 2-byte entry count + one 12-byte entry + 4-byte
 *  next-IFD offset (0 = none). */
function buildMinimalOrientationTiff(orientation: number): Buffer {
	const buf = Buffer.alloc(26);
	buf.write('II', 0, 'latin1');
	buf.writeUInt16LE(42, 2);
	buf.writeUInt32LE(8, 4); // IFD0 offset
	buf.writeUInt16LE(1, 8); // one entry
	buf.writeUInt16LE(0x0112, 10); // tag: Orientation
	buf.writeUInt16LE(3, 12); // type: SHORT
	buf.writeUInt32LE(1, 14); // count: 1
	buf.writeUInt16LE(orientation, 18); // value, left-justified in the 4-byte field (bytes 20-21 stay 0)
	buf.writeUInt32LE(0, 22); // next IFD offset: none
	return buf;
}

// --- JPEG -------------------------------------------------------------------
// Copy the SOI, then every marker segment except APP1..APP15 (EXIF/XMP/IPTC/Adobe) and COM (comments);
// APP0 (JFIF) is kept. At SOS the entropy-coded scan begins — copy the remainder verbatim. APP1 (Exif)
// is handled separately from APP2-15: if it carries an Orientation tag, a synthetic APP1 with only that
// tag replaces it (see readExifOrientation/buildMinimalOrientationTiff above); otherwise it's dropped
// like the rest.
function stripJpeg(buf: Buffer): Buffer {
	if (buf.length < 2 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
	const out: Buffer[] = [Buffer.from([0xff, 0xd8])];
	let i = 2;
	while (i + 1 < buf.length) {
		if (buf[i] !== 0xff) return buf; // malformed — bail, keep original
		const marker = buf[i + 1];
		if (marker === 0xd9) {
			out.push(buf.subarray(i)); // EOI + any trailer
			return Buffer.concat(out);
		}
		if (marker === 0xda) {
			out.push(buf.subarray(i)); // SOS onward is entropy data
			return Buffer.concat(out);
		}
		// RSTn / TEM / padding: standalone markers with no length field
		if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
			out.push(buf.subarray(i, i + 2));
			i += 2;
			continue;
		}
		if (i + 3 >= buf.length) return buf; // truncated length — bail
		const len = buf.readUInt16BE(i + 2);
		const segEnd = i + 2 + len;
		if (len < 2 || segEnd > buf.length) return buf; // corrupt — bail
		if (marker === 0xe1) {
			const orientation = readExifOrientation(buf.subarray(i + 4, segEnd));
			if (orientation != null && orientation !== 1) out.push(buildExifApp1Segment(orientation));
		} else {
			const isApp2Plus = marker >= 0xe2 && marker <= 0xef;
			const isComment = marker === 0xfe;
			if (!isApp2Plus && !isComment) out.push(buf.subarray(i, segEnd));
		}
		i = segEnd;
	}
	return Buffer.concat(out);
}

function buildExifApp1Segment(orientation: number): Buffer {
	const payload = Buffer.concat([EXIF_SIG, buildMinimalOrientationTiff(orientation)]);
	const header = Buffer.from([0xff, 0xe1, 0, 0]);
	header.writeUInt16BE(payload.length + 2, 2); // length field counts itself, not the FF E1 marker
	return Buffer.concat([header, payload]);
}

// --- PNG --------------------------------------------------------------------
// Copy the signature then every chunk except the ancillary metadata ones (text, EXIF, timestamp).
function stripPng(buf: Buffer): Buffer {
	const DROP = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME']);
	const out: Buffer[] = [buf.subarray(0, 8)];
	let i = 8;
	while (i + 8 <= buf.length) {
		const len = buf.readUInt32BE(i);
		const type = buf.subarray(i + 4, i + 8).toString('latin1');
		const chunkEnd = i + 12 + len; // length(4) + type(4) + data(len) + crc(4)
		if (chunkEnd > buf.length) return buf; // corrupt — bail
		if (!DROP.has(type)) out.push(buf.subarray(i, chunkEnd));
		if (type === 'IEND') break;
		i = chunkEnd;
	}
	return Buffer.concat(out);
}

// --- WebP -------------------------------------------------------------------
// Drop XMP chunks outright; for EXIF, keep only the Orientation tag (same rationale as JPEG's APP1 —
// see stripImageMetadata's doc comment) via a synthetic chunk, or drop it too if there's no orientation
// to preserve. Clear the corresponding VP8X flag bits for whatever actually ends up gone, and rewrite
// the RIFF size.
function stripWebp(buf: Buffer): Buffer {
	if (buf.length < 12) return buf;
	type Chunk = { fourcc: string; body: Buffer };
	const chunks: Chunk[] = [];
	let i = 12;
	while (i + 8 <= buf.length) {
		const fourcc = buf.subarray(i, i + 4).toString('latin1');
		const size = buf.readUInt32LE(i + 4);
		const dataStart = i + 8;
		const dataEnd = dataStart + size;
		if (dataEnd > buf.length) return buf; // corrupt — bail
		chunks.push({ fourcc, body: buf.subarray(dataStart, dataEnd) });
		i = dataEnd + (size % 2); // chunks are padded to an even length
	}
	let hadExif = false;
	let keptExif = false;
	const kept: Chunk[] = [];
	for (const c of chunks) {
		if (c.fourcc === 'XMP ') continue; // always dropped
		if (c.fourcc === 'EXIF') {
			hadExif = true;
			const orientation = readExifOrientation(c.body);
			if (orientation != null && orientation !== 1) {
				kept.push({ fourcc: 'EXIF', body: buildMinimalOrientationTiff(orientation) });
				keptExif = true;
			}
			continue;
		}
		kept.push(c);
	}
	if (kept.length === chunks.length && !hadExif) return buf; // nothing to strip (no XMP, no EXIF at all)
	const vp8x = kept.find((c) => c.fourcc === 'VP8X');
	if (vp8x && vp8x.body.length >= 1) {
		// VP8X flags byte: bit 3 = EXIF, bit 2 = XMP. XMP is always gone; EXIF only if we didn't keep one.
		vp8x.body = Buffer.from(vp8x.body);
		vp8x.body[0] &= ~0b00000100;
		if (!keptExif) vp8x.body[0] &= ~0b00001000;
	}
	const parts: Buffer[] = [];
	for (const c of kept) {
		const header = Buffer.alloc(8);
		header.write(c.fourcc, 0, 'latin1');
		header.writeUInt32LE(c.body.length, 4);
		parts.push(header, c.body);
		if (c.body.length % 2 === 1) parts.push(Buffer.from([0])); // re-pad
	}
	const payload = Buffer.concat(parts);
	const riff = Buffer.alloc(12);
	riff.write('RIFF', 0, 'latin1');
	riff.writeUInt32LE(payload.length + 4, 4); // size covers 'WEBP' + chunks
	riff.write('WEBP', 8, 'latin1');
	return Buffer.concat([riff, payload]);
}
