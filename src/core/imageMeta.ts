// Lightweight, bounds-checked detector for EXIF / GPS metadata in JPEG files.
// Used only to tell the user what will be stripped — the actual stripping is
// done by re-encoding through a canvas (which drops all metadata). Every offset
// derived from the file is validated against the buffer before use.

export interface ImageMeta {
  hasExif: boolean;
  hasGps: boolean;
}

const NONE: ImageMeta = { hasExif: false, hasGps: false };

export async function detectImageMeta(file: File): Promise<ImageMeta> {
  if (file.type !== "image/jpeg" && !/\.jpe?g$/i.test(file.name)) return NONE;
  // EXIF lives in an early APP1 segment; 256 KB is far more than enough.
  const buf = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  if (buf.length < 4) return NONE;
  const dv = new DataView(buf.buffer);
  if (dv.getUint16(0) !== 0xffd8) return NONE; // not a JPEG (no SOI)

  let off = 2;
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff) break; // not at a marker — bail
    const marker = buf[off + 1];
    if (marker === 0xd9 || marker === 0xda) break; // EOI / start of scan
    const len = dv.getUint16(off + 2);
    if (len < 2) break; // malformed segment length
    const segStart = off + 4;
    const segEnd = off + 2 + len;
    if (segEnd > buf.length) break;
    if (marker === 0xe1 && segEnd - segStart >= 6) {
      // "Exif\0\0"
      if (
        buf[segStart] === 0x45 &&
        buf[segStart + 1] === 0x78 &&
        buf[segStart + 2] === 0x69 &&
        buf[segStart + 3] === 0x66 &&
        buf[segStart + 4] === 0 &&
        buf[segStart + 5] === 0
      ) {
        return { hasExif: true, hasGps: exifHasGps(dv, buf, segStart + 6, segEnd) };
      }
    }
    off = segEnd; // len >= 2 guarantees forward progress
  }
  return NONE;
}

/** Parse the TIFF header at `tiff` and report whether IFD0 has a GPS pointer. */
function exifHasGps(dv: DataView, buf: Uint8Array, tiff: number, end: number): boolean {
  if (tiff + 8 > end) return false;
  const le = buf[tiff] === 0x49; // 'II' little-endian, 'MM' big-endian
  const u16 = (o: number) => dv.getUint16(o, le);
  const u32 = (o: number) => dv.getUint32(o, le);
  if (u16(tiff + 2) !== 0x002a) return false; // TIFF magic
  const ifd0 = tiff + u32(tiff + 4);
  if (ifd0 < tiff || ifd0 + 2 > end) return false;
  const count = u16(ifd0);
  let p = ifd0 + 2;
  for (let i = 0; i < count && p + 12 <= end; i++, p += 12) {
    if (u16(p) === 0x8825) return true; // GPSInfo IFD pointer
  }
  return false;
}
