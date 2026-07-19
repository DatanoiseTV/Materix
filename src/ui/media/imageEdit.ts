// Canvas-based image processing for the send-time editor. Re-encoding through a
// canvas is what strips EXIF/GPS/metadata; redactions are baked into the pixels
// (destructive) so a censored region carries no recoverable data.

export type Orient = 0 | 1 | 2 | 3; // number of 90° clockwise turns
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Redaction extends Rect {
  mode: "blackout" | "pixelate";
}

export interface PenStroke {
  points: { x: number; y: number }[];
  color: string;
  width: number;
}

export interface EditState {
  orient: Orient;
  redactions: Redaction[];
  strokes: PenStroke[];
  crop: Rect | null;
}

/** Draw a freehand pen stroke (points in oriented-image coordinates). */
export function drawStroke(ctx: CanvasRenderingContext2D, s: PenStroke, scale = 1): void {
  if (s.points.length === 0) return;
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.lineWidth = Math.max(1, s.width * scale);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(s.points[0].x * scale, s.points[0].y * scale);
  for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x * scale, s.points[i].y * scale);
  if (s.points.length === 1) ctx.lineTo(s.points[0].x * scale + 0.1, s.points[0].y * scale + 0.1);
  ctx.stroke();
  ctx.restore();
}

/** Map a rect into the space after one 90° clockwise turn; `oldH` is the pre-turn height. */
export function rotateRectCW(r: Rect, oldH: number): Rect {
  return { x: oldH - (r.y + r.h), y: r.x, w: r.h, h: r.w };
}

type Source = ImageBitmap | HTMLImageElement;

function srcW(s: Source): number {
  return "width" in s ? s.width : (s as HTMLImageElement).naturalWidth;
}
function srcH(s: Source): number {
  return "height" in s ? s.height : (s as HTMLImageElement).naturalHeight;
}

/** Draw the source into a canvas at its natural size with `orient` applied. */
export function drawOriented(source: Source, orient: Orient): HTMLCanvasElement {
  const w = srcW(source);
  const h = srcH(source);
  const rotated = orient % 2 === 1;
  const canvas = document.createElement("canvas");
  canvas.width = rotated ? h : w;
  canvas.height = rotated ? w : h;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((orient * Math.PI) / 2);
  ctx.drawImage(source, -w / 2, -h / 2);
  return canvas;
}

function applyRedaction(ctx: CanvasRenderingContext2D, r: Redaction): void {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  const w = Math.round(r.w);
  const h = Math.round(r.h);
  if (w <= 0 || h <= 0) return;
  if (r.mode === "blackout") {
    ctx.fillStyle = "#000";
    ctx.fillRect(x, y, w, h);
    return;
  }
  // Pixelate: downscale the region then scale it back up (mosaic).
  const block = Math.max(6, Math.round(Math.min(w, h) / 8));
  const sw = Math.max(1, Math.round(w / block));
  const sh = Math.max(1, Math.round(h / block));
  const tmp = document.createElement("canvas");
  tmp.width = sw;
  tmp.height = sh;
  const tctx = tmp.getContext("2d")!;
  tctx.drawImage(ctx.canvas, x, y, w, h, 0, 0, sw, sh);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, sw, sh, x, y, w, h);
  ctx.imageSmoothingEnabled = true;
}

/** Render the fully-processed image (orient + redactions + crop) to a canvas. */
export function renderProcessed(source: Source, state: EditState): HTMLCanvasElement {
  const oriented = drawOriented(source, state.orient);
  const ctx = oriented.getContext("2d")!;
  for (const r of state.redactions) applyRedaction(ctx, r);
  for (const s of state.strokes) drawStroke(ctx, s);
  if (!state.crop) return oriented;
  const c = state.crop;
  const cw = Math.max(1, Math.round(c.w));
  const ch = Math.max(1, Math.round(c.h));
  const out = document.createElement("canvas");
  out.width = cw;
  out.height = ch;
  out.getContext("2d")!.drawImage(oriented, Math.round(c.x), Math.round(c.y), cw, ch, 0, 0, cw, ch);
  return out;
}

/** True when the state changes pixels (so re-encoding is required). */
export function hasEdits(state: EditState): boolean {
  return (
    state.orient !== 0 ||
    state.redactions.length > 0 ||
    state.strokes.length > 0 ||
    state.crop !== null
  );
}

/** Export a processed image to a File. Always strips metadata (canvas re-encode). */
export async function exportImageFile(source: Source, state: EditState, name: string, mime: string): Promise<File> {
  const canvas = renderProcessed(source, state);
  // Preserve PNG (alpha); everything else becomes JPEG for size + universal strip.
  const type = mime === "image/png" ? "image/png" : "image/jpeg";
  const quality = type === "image/jpeg" ? 0.92 : undefined;
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Image encoding failed"))), type, quality),
  );
  const outName = renameForType(name, type);
  return new File([blob], outName, { type });
}

function renameForType(name: string, type: string): string {
  const ext = type === "image/png" ? "png" : "jpg";
  const base = name.replace(/\.[^.]+$/, "");
  return `${base}.${ext}`;
}
