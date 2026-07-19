// Send-time image editor: crop, rotate, freehand pen annotations, and securely
// censor (black-out or pixelate) regions, with EXIF/GPS metadata stripping on by
// default. Redactions/annotations are baked destructively into the exported
// pixels; metadata is dropped by the canvas re-encode. See imageEdit.ts.

import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { IconShield } from "./Icons";
import { detectImageMeta, type ImageMeta } from "../../core/imageMeta";
import {
  drawOriented,
  drawStroke,
  exportImageFile,
  hasEdits,
  rotateRectCW,
  type Orient,
  type PenStroke,
  type Rect,
  type Redaction,
} from "../media/imageEdit";

type Tool = "blackout" | "pixelate" | "pen" | "crop";
type Point = { x: number; y: number };
const MAX_W = 620;
const MAX_H = 440;
const PEN_COLORS = ["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#ffffff", "#000000"];

export function ImageEditor({
  file,
  onSend,
  onCancel,
}: {
  file: File;
  onSend: (file: File, caption: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [source, setSource] = useState<ImageBitmap | null>(null);
  const [meta, setMeta] = useState<ImageMeta>({ hasExif: false, hasGps: false });
  const [orient, setOrient] = useState<Orient>(0);
  const [redactions, setRedactions] = useState<Redaction[]>([]);
  const [strokes, setStrokes] = useState<PenStroke[]>([]);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [undoOrder, setUndoOrder] = useState<("redact" | "pen" | "crop")[]>([]);
  const [tool, setTool] = useState<Tool>("pen");
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const [stripMeta, setStripMeta] = useState(true);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [rect, setRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [stroke, setStroke] = useState<Point[] | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let alive = true;
    createImageBitmap(file)
      .then((bmp) => alive && setSource(bmp))
      .catch(() => undefined);
    detectImageMeta(file)
      .then((m) => alive && setMeta(m))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [file]);

  const orientedW = source ? (orient % 2 ? source.height : source.width) : 0;
  const orientedH = source ? (orient % 2 ? source.width : source.height) : 0;
  const scale = source ? Math.min(MAX_W / orientedW, MAX_H / orientedH, 1) : 1;
  const dispW = Math.round(orientedW * scale);
  const dispH = Math.round(orientedH * scale);
  const penWidth = Math.max(3, Math.round(Math.max(orientedW, orientedH) / 220));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source) return;
    canvas.width = dispW;
    canvas.height = dispH;
    const ctx = canvas.getContext("2d")!;
    // Oriented image with baked redactions + strokes, at natural res.
    const oriented = drawOriented(source, orient);
    const octx = oriented.getContext("2d")!;
    for (const r of redactions) {
      if (r.mode === "blackout") {
        octx.fillStyle = "#000";
        octx.fillRect(r.x, r.y, r.w, r.h);
      } else {
        const block = Math.max(6, Math.round(Math.min(r.w, r.h) / 8));
        const sw = Math.max(1, Math.round(r.w / block));
        const sh = Math.max(1, Math.round(r.h / block));
        const tmp = document.createElement("canvas");
        tmp.width = sw;
        tmp.height = sh;
        tmp.getContext("2d")!.drawImage(oriented, r.x, r.y, r.w, r.h, 0, 0, sw, sh);
        octx.imageSmoothingEnabled = false;
        octx.drawImage(tmp, 0, 0, sw, sh, r.x, r.y, r.w, r.h);
        octx.imageSmoothingEnabled = true;
      }
    }
    for (const s of strokes) drawStroke(octx, s);
    ctx.clearRect(0, 0, dispW, dispH);
    ctx.drawImage(oriented, 0, 0, dispW, dispH);

    if (crop) {
      const cx = crop.x * scale;
      const cy = crop.y * scale;
      const cw = crop.w * scale;
      const ch = crop.h * scale;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, 0, dispW, cy);
      ctx.fillRect(0, cy + ch, dispW, dispH - cy - ch);
      ctx.fillRect(0, cy, cx, ch);
      ctx.fillRect(cx + cw, cy, dispW - cx - cw, ch);
      ctx.strokeStyle = "#fff";
      ctx.strokeRect(cx + 0.5, cy + 0.5, cw, ch);
    }
    if (rect) {
      const x = Math.min(rect.x0, rect.x1);
      const y = Math.min(rect.y0, rect.y1);
      const w = Math.abs(rect.x1 - rect.x0);
      const h = Math.abs(rect.y1 - rect.y0);
      ctx.save();
      ctx.strokeStyle = tool === "crop" ? "#fff" : "#000";
      ctx.fillStyle = tool === "crop" ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.35)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }
    if (stroke) drawStroke(ctx, { points: stroke, color: penColor, width: penWidth }, scale);
  }, [source, orient, redactions, strokes, crop, rect, stroke, tool, penColor, penWidth, dispW, dispH, scale]);

  const disp = (e: React.PointerEvent): Point => {
    const r = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(dispW, e.clientX - r.left)),
      y: Math.max(0, Math.min(dispH, e.clientY - r.top)),
    };
  };
  const pushUndo = (k: "redact" | "pen" | "crop") => setUndoOrder((u) => [...u, k]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!source) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = disp(e);
    if (tool === "pen") setStroke([{ x: p.x / scale, y: p.y / scale }]);
    else setRect({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = disp(e);
    if (tool === "pen") {
      if (stroke) setStroke((s) => (s ? [...s, { x: p.x / scale, y: p.y / scale }] : s));
    } else if (rect) {
      setRect((r) => (r ? { ...r, x1: p.x, y1: p.y } : r));
    }
  };
  const onPointerUp = () => {
    if (tool === "pen") {
      if (stroke && stroke.length) {
        setStrokes((ss) => [...ss, { points: stroke, color: penColor, width: penWidth }]);
        pushUndo("pen");
      }
      setStroke(null);
      return;
    }
    if (!rect) return;
    const x = Math.min(rect.x0, rect.x1) / scale;
    const y = Math.min(rect.y0, rect.y1) / scale;
    const w = Math.abs(rect.x1 - rect.x0) / scale;
    const h = Math.abs(rect.y1 - rect.y0) / scale;
    setRect(null);
    if (w < 4 || h < 4) return;
    if (tool === "crop") {
      setCrop({ x, y, w, h });
      pushUndo("crop");
    } else {
      setRedactions((rs) => [...rs, { x, y, w, h, mode: tool }]);
      pushUndo("redact");
    }
  };

  const rotate = () => {
    const oldH = orientedH;
    setRedactions((rs) => rs.map((r) => ({ ...rotateRectCW(r, oldH), mode: r.mode })));
    setStrokes((ss) =>
      ss.map((s) => ({ ...s, points: s.points.map((p) => ({ x: oldH - p.y, y: p.x })) })),
    );
    setCrop((c) => (c ? rotateRectCW(c, oldH) : null));
    setOrient((o) => ((o + 1) % 4) as Orient);
  };

  const undo = () => {
    const last = undoOrder[undoOrder.length - 1];
    if (!last) return;
    setUndoOrder((u) => u.slice(0, -1));
    if (last === "redact") setRedactions((rs) => rs.slice(0, -1));
    else if (last === "pen") setStrokes((ss) => ss.slice(0, -1));
    else setCrop(null);
  };

  const doSend = async () => {
    if (!source) return;
    setBusy(true);
    try {
      const state = { orient, redactions, strokes, crop };
      const out =
        !stripMeta && !hasEdits(state) ? file : await exportImageFile(source, state, file.name, file.type);
      await onSend(out, caption.trim());
    } finally {
      setBusy(false);
    }
  };

  const toolBtn = (id: Tool, label: string) => (
    <button className={`chip${tool === id ? " selected" : ""}`} onClick={() => setTool(id)} aria-pressed={tool === id}>
      {label}
    </button>
  );

  return (
    <Modal
      title="Edit image before sending"
      onClose={onCancel}
      wide
      footer={
        <>
          <button className="btn secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" onClick={doSend} disabled={busy || !source}>
            {busy ? "Sending…" : "Send"}
          </button>
        </>
      }
    >
      <div className="img-editor">
        <div className="img-editor-tools" role="toolbar" aria-label="Image tools">
          {toolBtn("pen", "Pen")}
          {toolBtn("blackout", "Black out")}
          {toolBtn("pixelate", "Pixelate")}
          {toolBtn("crop", "Crop")}
          <span style={{ flex: 1 }} />
          <button className="chip" onClick={rotate} disabled={!source}>
            Rotate
          </button>
          <button className="chip" onClick={undo} disabled={!undoOrder.length}>
            Undo
          </button>
        </div>

        {tool === "pen" && (
          <div className="img-editor-swatches" role="radiogroup" aria-label="Pen color">
            {PEN_COLORS.map((c) => (
              <button
                key={c}
                className={`swatch${penColor === c ? " selected" : ""}`}
                style={{ background: c }}
                onClick={() => setPenColor(c)}
                role="radio"
                aria-checked={penColor === c}
                aria-label={`Pen color ${c}`}
              />
            ))}
          </div>
        )}

        <div className="img-editor-stage" style={{ width: dispW || undefined, height: dispH || undefined }}>
          {source ? (
            <canvas
              ref={canvasRef}
              className="img-editor-canvas"
              style={{ cursor: "crosshair", touchAction: "none" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
          ) : (
            <span className="spinner" />
          )}
        </div>

        <div className="field-hint">
          {tool === "crop"
            ? "Drag on the image to set the crop area."
            : tool === "pen"
              ? "Draw on the image to annotate."
              : "Drag over the parts you want to hide — the pixels are permanently removed."}
        </div>

        <label className="switch-row" style={{ cursor: "pointer" }}>
          <div>
            <div className="switch-title" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <IconShield size={15} /> Remove metadata
            </div>
            <div className="switch-sub">
              {meta.hasGps
                ? "This photo contains GPS location — it will be removed."
                : meta.hasExif
                  ? "Camera and capture metadata will be removed."
                  : "Strip any hidden metadata (recommended)."}
            </div>
          </div>
          <input
            type="checkbox"
            checked={stripMeta}
            onChange={(e) => setStripMeta(e.target.checked)}
            aria-label="Remove metadata"
          />
        </label>

        <input
          className="img-editor-caption"
          placeholder="Add a caption…"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          aria-label="Caption"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void doSend();
            }
          }}
        />
      </div>
    </Modal>
  );
}
