"use client";
import { useEffect, useRef, useState } from "react";

type View = {
  hemi: string; kind: string; width: number; height: number; n_faces: number;
  xy: Uint16Array; faces: Uint16Array; face_region: Int16Array; shade: Uint8Array;
};

let meshPromise: Promise<View[]> | null = null;
function loadMesh(): Promise<View[]> {
  const dec = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;
  meshPromise ??= fetch("/brain_mesh.json")
    .then((r) => r.json())
    .then((m) =>
      m.views.map((v: Record<string, unknown>) => ({
        ...v,
        xy: new Uint16Array(dec(v.xy as string)),
        faces: new Uint16Array(dec(v.faces as string)),
        face_region: new Int16Array(dec(v.face_region as string)),
        shade: new Uint8Array(dec(v.shade as string)),
      }))
    );
  return meshPromise;
}

// diverging blue - neutral - red, z clamped to [-LIM, LIM]
const LIM = 2.5;
function color(z: number, shade: number, neutral: [number, number, number]): string {
  const u = Math.max(-1, Math.min(1, z / LIM));
  const hot: [number, number, number] = u >= 0 ? [214, 69, 47] : [47, 111, 214];
  const a = Math.abs(u);
  const c = neutral.map((n, i) => Math.round((n + (hot[i] - n) * a) * shade));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

type Props = { regionsZ: number[] | undefined; regionNames: string[]; t: number };

export default function BrainMap({ regionsZ, regionNames, t }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [views, setViews] = useState<View[] | null>(null);
  const [tip, setTip] = useState("");

  useEffect(() => {
    loadMesh().then(setViews).catch(() => setViews([]));
  }, []);

  // layout: 2 x 2 grid of views
  const CELL = 300;
  const ROW = 0.82; // row height relative to cell width (views are wider than tall)
  const layout = views?.map((v, i) => {
    const s = (CELL - 16) / Math.max(v.width, v.height);
    return { v, s, ox: (i % 2) * CELL + 8 + (CELL - 16 - v.width * s) / 2, oy: Math.floor(i / 2) * (CELL * ROW) + 8 };
  });

  useEffect(() => {
    const el = canvas.current;
    if (!el || !layout) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = 2 * CELL * dpr;
    el.height = 2 * CELL * ROW * dpr;
    const ctx = el.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, 2 * CELL, 2 * CELL * ROW);
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    const neutral: [number, number, number] = dark ? [72, 72, 82] : [222, 222, 218];
    for (const { v, s, ox, oy } of layout) {
      for (let f = 0; f < v.n_faces; f++) {
        const a = v.faces[3 * f], b = v.faces[3 * f + 1], c = v.faces[3 * f + 2];
        const reg = v.face_region[f];
        const z = reg >= 0 && regionsZ ? regionsZ[reg] : 0;
        ctx.fillStyle = color(reg >= 0 ? z : 0, v.shade[f] / 255, reg >= 0 ? neutral : [neutral[0] * 0.8, neutral[1] * 0.8, neutral[2] * 0.8]);
        ctx.beginPath();
        ctx.moveTo(ox + v.xy[2 * a] * s, oy + v.xy[2 * a + 1] * s);
        ctx.lineTo(ox + v.xy[2 * b] * s, oy + v.xy[2 * b + 1] * s);
        ctx.lineTo(ox + v.xy[2 * c] * s, oy + v.xy[2 * c + 1] * s);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = ctx.fillStyle; // hide hairline seams between triangles
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
      ctx.fillStyle = dark ? "#9a9aa6" : "#6b6b72";
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillText(`${v.hemi === "lh" ? "Left" : "Right"} · ${v.kind}`, ox, oy + v.height * s + 14);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views, regionsZ]);

  // hover: nearest face centroid in the view under the pointer -> region name + value
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!layout || !regionsZ) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 2 * CELL;
    const py = ((e.clientY - r.top) / r.height) * 2 * CELL * ROW;
    for (const { v, s, ox, oy } of layout) {
      if (px < ox || py < oy || px > ox + v.width * s || py > oy + v.height * s) continue;
      // last drawn (nearest to the viewer) face containing the point wins: scan from the end
      for (let f = v.n_faces - 1; f >= 0; f--) {
        const a = v.faces[3 * f], b = v.faces[3 * f + 1], c = v.faces[3 * f + 2];
        const ax = ox + v.xy[2 * a] * s, ay = oy + v.xy[2 * a + 1] * s;
        const bx = ox + v.xy[2 * b] * s, by = oy + v.xy[2 * b + 1] * s;
        const cx = ox + v.xy[2 * c] * s, cy = oy + v.xy[2 * c + 1] * s;
        const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
        const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
        const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
        const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
        if (!(neg && pos)) {
          const reg = v.face_region[f];
          setTip(reg >= 0 ? `${regionNames[reg] ?? reg}: z ${regionsZ[reg] > 0 ? "+" : ""}${regionsZ[reg]?.toFixed(2)}` : "medial wall (no data)");
          return;
        }
      }
    }
    setTip("");
  };

  return (
    <div className="brain">
      {views && views.length === 0 ? (
        <p className="err">Could not load /brain_mesh.json. Run: python tribe/export_mesh.py</p>
      ) : (
        <canvas ref={canvas} onPointerMove={onMove} onPointerLeave={() => setTip("")} aria-label={`Predicted regional response at t=${t}s`} role="img" />
      )}
      <div className="scale">
        <span>below pitch average</span>
        <div className="bar" />
        <span>above</span>
      </div>
      <div className="regionTip">{tip || "Hover a region. Colours are TRIBE v2 predicted response, z-scored within this pitch."}</div>
    </div>
  );
}
