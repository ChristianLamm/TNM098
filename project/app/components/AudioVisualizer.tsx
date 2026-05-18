"use client";
import React, { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import Spectrogram from "wavesurfer.js/dist/plugins/spectrogram.esm.js";

type Props = {
  audioUrl: string;
  title: string;
  subtitle?: string;
  type: "kasios" | "verified";
};

// Magma colormap: near-black → dark purple → orange → bright yellow
// Silence/noise = dark; bird calls = amber/white — high contrast for frequency patterns
const MAGMA: [number, number, number, number][] = (() => {
  const stops = [
    [0, 0, 4],
    [27, 16, 68],
    [59, 15, 112],
    [100, 26, 128],
    [140, 41, 129],
    [182, 54, 121],
    [222, 73, 104],
    [247, 112, 92],
    [254, 159, 109],
    [254, 207, 146],
    [252, 253, 191],
  ];
  return Array.from({ length: 256 }, (_, i) => {
    const t = (i / 255) * (stops.length - 1);
    const lo = Math.floor(t);
    const hi = Math.min(lo + 1, stops.length - 1);
    const f = t - lo;
    const lerp = (a: number, b: number) => Math.round(a + (b - a) * f);
    return [lerp(stops[lo][0], stops[hi][0]), lerp(stops[lo][1], stops[hi][1]), lerp(stops[lo][2], stops[hi][2]), 255] as [number, number, number, number];
  });
})();

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
}

export default function AudioVisualizer({ audioUrl, title, subtitle, type }: Props) {
  const waveRef = useRef<HTMLDivElement>(null);
  const specRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);

  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showWave, setShowWave] = useState(false);

  useEffect(() => {
    if (!waveRef.current || !specRef.current) return;
    setReady(false);
    setPlaying(false);
    setTime(0);
    setDuration(0);

    const ws = WaveSurfer.create({
      container: waveRef.current,
      waveColor: type === "kasios" ? "#fb923c" : "#818cf8",
      progressColor: type === "kasios" ? "#ea580c" : "#4f46e5",
      cursorColor: "rgba(255,255,255,0.6)",
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      height: 56,
      url: audioUrl,
      plugins: [
        Spectrogram.create({
          container: specRef.current,
          labels: true,
          labelsBackground: "rgba(0,0,0,0.55)",
          labelsColor: "#94a3b8",
          height: 240,
          fftSamples: 1024,
          frequencyMax: 10000,
          colorMap: MAGMA,
        }),
      ],
    });

    ws.on("ready", () => {
      setReady(true);
      setDuration(ws.getDuration());
    });
    ws.on("play", () => setPlaying(true));
    ws.on("pause", () => setPlaying(false));
    ws.on("finish", () => setPlaying(false));
    ws.on("timeupdate", (t: number) => setTime(t));

    wsRef.current = ws;
    return () => ws.destroy();
  }, [audioUrl, type]);

  const togglePlay = () => wsRef.current?.playPause();
  const skip = (delta: number) => wsRef.current?.skip(delta);

  return (
    <div className="flex flex-col bg-[#0c0c10] rounded-xl border border-stone-800 overflow-hidden shadow-xl">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-800/70">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate">{title}</p>
          {subtitle && <p className="text-xs text-stone-400 mt-0.5 truncate">{subtitle}</p>}
        </div>
        <button
          onClick={() => setShowWave((v) => !v)}
          className={`ml-3 shrink-0 text-xs px-2.5 py-1 rounded-md border transition-colors ${
            showWave
              ? "bg-stone-700 text-white border-stone-600"
              : "text-stone-500 border-stone-700 hover:text-stone-300 hover:border-stone-600"
          }`}
        >
          {showWave ? "Hide waveform" : "Show waveform"}
        </button>
      </div>

      {/* Visualization */}
      <div className="relative bg-black">
        {!ready && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0c0c10]/95">
            <span className="text-stone-500 text-xs tracking-wide animate-pulse">Rendering spectrogram…</span>
          </div>
        )}

        {/* Waveform — hidden until toggled, but always rendered so WaveSurfer stays mounted */}
        <div
          ref={waveRef}
          className="w-full overflow-hidden transition-[height] duration-300"
          style={{ height: showWave ? 56 : 0 }}
        />

        {/* Spectrogram — always visible */}
        <div ref={specRef} className="w-full" />
      </div>

      {/* Playback controls */}
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-t border-stone-800/70">
        <button
          onClick={() => skip(-5)}
          disabled={!ready}
          title="Back 5 s"
          className="text-stone-500 hover:text-stone-200 disabled:opacity-25 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
          </svg>
        </button>

        <button
          onClick={togglePlay}
          disabled={!ready}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-stone-800 disabled:opacity-30 text-white transition-colors shadow"
        >
          {playing ? (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        <button
          onClick={() => skip(5)}
          disabled={!ready}
          title="Forward 5 s"
          className="text-stone-500 hover:text-stone-200 disabled:opacity-25 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18 6h-2v12h2zm-3.5 6L6 6v12z" />
          </svg>
        </button>

        <span className="text-xs text-stone-500 font-mono tabular-nums ml-1">
          {fmtTime(time)} / {fmtTime(duration)}
        </span>
      </div>
    </div>
  );
}
