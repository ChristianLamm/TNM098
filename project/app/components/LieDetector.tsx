"use client";

import { useEffect, useMemo, useState } from "react";
import AudioVisualizer from "./AudioVisualizer";

type Prediction = {
  species:    string;
  confidence: number;
  fid:        string;
  distance:   number;
  type:       string;
};

type KasiosData = {
  predictions:        Prediction[];
  bestPipitMatch:     string | null;
  bestPipitScore:     number | null;
  overallBestMatch:   string;
  overallBestSpecies: string;
};

type ClassifierMode = "ml" | "dtw";
type CompareMode    = "pipit" | "actual";

function sortKeys(keys: string[]) {
  return [...keys].sort((a, b) => {
    const na = parseInt(a.match(/\d+/)?.[0] ?? "0");
    const nb = parseInt(b.match(/\d+/)?.[0] ?? "0");
    return na - nb;
  });
}

function fmtScore(d: number, mode: ClassifierMode): string {
  if (mode === "dtw") return d >= 1000 ? (d / 1000).toFixed(1) + "k" : d.toFixed(2);
  return d.toFixed(3);
}

async function loadJson(url: string): Promise<Record<string, KasiosData> | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export default function LieDetector() {
  const [comparisonsML,  setComparisonsML]  = useState<Record<string, KasiosData>>({});
  const [comparisonsDTW, setComparisonsDTW] = useState<Record<string, KasiosData>>({});
  const [selectedFile,   setSelectedFile]   = useState<string | null>(null);
  const [classifierMode, setClassifierMode] = useState<ClassifierMode>("ml");
  const [compareMode,    setCompareMode]    = useState<CompareMode>("actual");
  const [availableML,    setAvailableML]    = useState(false);
  const [availableDTW,   setAvailableDTW]   = useState(false);

  useEffect(() => {
    Promise.all([
      loadJson("/comparisons_ml.json"),
      loadJson("/comparisons_dtw.json"),
    ]).then(([ml, dtw]) => {
      if (ml)  { setComparisonsML(ml);  setAvailableML(true);  }
      if (dtw) { setComparisonsDTW(dtw); setAvailableDTW(true); }

      const initial = ml ?? dtw;
      if (initial) {
        const keys = sortKeys(Object.keys(initial));
        if (keys.length) setSelectedFile(keys[0]);
      }
      // Default to whichever is available
      if (ml)       setClassifierMode("ml");
      else if (dtw) setClassifierMode("dtw");
    });
  }, []);

  const comparisons = classifierMode === "ml" ? comparisonsML : comparisonsDTW;
  const fileKeys    = useMemo(() => sortKeys(Object.keys(comparisons)), [comparisons]);

  // When switching classifier, keep selected file if it exists in the new dataset
  useEffect(() => {
    if (selectedFile && comparisons[selectedFile]) return;
    const keys = sortKeys(Object.keys(comparisons));
    if (keys.length) setSelectedFile(keys[0]);
  }, [classifierMode]);

  if (!availableML && !availableDTW) {
    return (
      <div className="p-8 text-center text-stone-500 text-xl">
        Loading Classifier Data…
      </div>
    );
  }

  const data = selectedFile ? comparisons[selectedFile] : null;

  if (!data || !selectedFile) {
    return (
      <div className="p-8 text-center text-stone-500">
        {fileKeys.length === 0
          ? "No predictions available for this classifier. Run the script first."
          : "Select a file above."}
      </div>
    );
  }

  const top     = data.predictions[0];
  const pipit   = data.predictions.find((p) => p.species === "Rose-crested Blue Pipit") ?? null;
  const isPipit = top.species === "Rose-crested Blue Pipit";

  const verifiedId  = compareMode === "pipit" ? data.bestPipitMatch  : data.overallBestMatch;
  const verifiedDist = compareMode === "pipit" ? data.bestPipitScore  : data.predictions[0].distance;
  const verifiedType = compareMode === "pipit" ? null                 : data.predictions[0].type;

  const kasiosUrl   = `/api/audio?type=kasios&filename=${selectedFile}`;
  const verifiedUrl = verifiedId ? `/api/audio?type=verified&id=${verifiedId}` : null;

  const scoreLabel = classifierMode === "dtw" ? "DTW" : "dist";

  return (
    <div className="flex flex-col bg-stone-50 rounded-xl shadow-lg border border-stone-200 overflow-hidden mt-10">

      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 px-6 py-5 bg-white border-b border-stone-200">
        <h2 className="text-2xl font-bold text-stone-900">Lie Detector</h2>

        <div className="flex gap-3 flex-wrap items-end">

          {/* Classifier toggle */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
              Classifier
            </span>
            <div className="flex bg-white border border-stone-300 rounded-lg p-0.5 shadow-sm">
              <button
                disabled={!availableML}
                onClick={() => setClassifierMode("ml")}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  classifierMode === "ml"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-stone-500 hover:text-stone-900"
                }`}
              >
                ML
              </button>
              <button
                disabled={!availableDTW}
                onClick={() => setClassifierMode("dtw")}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  classifierMode === "dtw"
                    ? "bg-violet-600 text-white shadow-sm"
                    : "text-stone-500 hover:text-stone-900"
                }`}
              >
                DTW
              </button>
            </div>
          </div>

          {/* File selector */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
              Kasios File
            </span>
            <select
              value={selectedFile}
              onChange={(e) => setSelectedFile(e.target.value)}
              className="bg-white border border-stone-300 text-stone-700 text-sm rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono shadow-sm cursor-pointer"
            >
              {fileKeys.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>

          {/* Compare mode */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
              Compare Against
            </span>
            <div className="flex bg-white border border-stone-300 rounded-lg p-0.5 shadow-sm">
              <button
                onClick={() => setCompareMode("pipit")}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  compareMode === "pipit"
                    ? "bg-rose-600 text-white shadow-sm"
                    : "text-stone-500 hover:text-stone-900"
                }`}
              >
                Claimed Pipit
              </button>
              <button
                onClick={() => setCompareMode("actual")}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  compareMode === "actual"
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-stone-500 hover:text-stone-900"
                }`}
              >
                Actual Match
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* ── Body ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 p-6">

        {/* Left panel */}
        <div className="flex flex-col gap-4">

          {/* Top predictions */}
          <div className="bg-white rounded-xl border border-stone-200 p-5 flex flex-col gap-4">
            <h3 className="font-semibold text-stone-700 text-sm border-b border-stone-100 pb-2">
              Top predictions
            </h3>
            <div className="space-y-3.5">
              {data.predictions.map((p, idx) => (
                <div key={p.species} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span
                      className={`font-semibold truncate pr-2 ${
                        idx === 0 ? "text-indigo-600" : "text-stone-600"
                      }`}
                      title={p.species}
                    >
                      {idx === 0 && (
                        <span className="text-stone-400 font-normal mr-1">1.</span>
                      )}
                      {p.species}
                    </span>
                    <span className="text-stone-400 font-mono shrink-0">
                      {p.confidence.toFixed(1)}%
                    </span>
                  </div>
                  <div className="w-full bg-stone-100 h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${
                        idx === 0 ? "bg-indigo-500" : "bg-stone-300"
                      }`}
                      style={{ width: `${Math.min(p.confidence * 5, 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-stone-400 font-mono">
                    {scoreLabel} {fmtScore(p.distance, classifierMode)}
                    {p.type ? ` · ${p.type}` : ""}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Verdict */}
          <div
            className={`px-3 py-2.5 rounded-lg border text-xs ${
              isPipit
                ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                : "bg-rose-50 border-rose-200 text-rose-700"
            }`}
          >
            <span className="font-semibold">
              {isPipit ? "Likely genuine" : "Not a Pipit"}
            </span>
            {!isPipit && pipit && data.bestPipitScore != null && (
              ` — matches ${top.species} (×${(data.bestPipitScore / top.distance).toFixed(1)} worse fit as Pipit)`
            )}
          </div>

          {/* Score comparison */}
          <div className="bg-white rounded-xl border border-stone-200 p-4 text-xs space-y-1.5">
            {classifierMode === "ml" ? (
              <>
                <div className="flex justify-between text-stone-500">
                  <span>Pipit confidence</span>
                  <span className="font-mono text-stone-700">
                    {pipit ? `${pipit.confidence.toFixed(1)}%` : "—"}
                  </span>
                </div>
                <div className="flex justify-between text-stone-500">
                  <span>Top match</span>
                  <span className="font-mono text-stone-700">
                    {top.confidence.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between border-t border-stone-100 pt-1.5 text-stone-600 font-medium">
                  <span>Gap</span>
                  <span className={`font-mono ${isPipit ? "text-emerald-600" : "text-rose-500"}`}>
                    {pipit
                      ? `${(top.confidence - pipit.confidence).toFixed(1)}%`
                      : "—"}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between text-stone-500">
                  <span>Pipit distance</span>
                  <span className="font-mono text-stone-700">
                    {data.bestPipitScore != null
                      ? fmtScore(data.bestPipitScore, "dtw")
                      : "—"}
                  </span>
                </div>
                <div className="flex justify-between text-stone-500">
                  <span>Best match</span>
                  <span className="font-mono text-stone-700">
                    {fmtScore(top.distance, "dtw")}
                  </span>
                </div>
                <div className="flex justify-between border-t border-stone-100 pt-1.5 text-stone-600 font-medium">
                  <span>Ratio</span>
                  <span className="font-mono text-rose-500">
                    {data.bestPipitScore != null
                      ? `×${(data.bestPipitScore / top.distance).toFixed(2)}`
                      : "—"}
                  </span>
                </div>
              </>
            )}
          </div>

        </div>

        {/* Right panel — spectrograms */}
        <div className="flex flex-col gap-4">
          <AudioVisualizer
            key={`kasios-${selectedFile}`}
            title={`Kasios submission — ${selectedFile}`}
            subtitle="Claimed to be Rose-crested Blue Pipit"
            audioUrl={kasiosUrl}
            type="kasios"
          />

          {verifiedUrl && (
            <AudioVisualizer
              key={`verified-${verifiedId}-${compareMode}-${classifierMode}`}
              title={
                compareMode === "pipit"
                  ? `Best Pipit match — ID ${verifiedId}`
                  : `Best match: ${data.overallBestSpecies} — ID ${verifiedId}`
              }
              subtitle={
                compareMode === "pipit"
                  ? `Rose-crested Blue Pipit · ${scoreLabel} ${data.bestPipitScore != null ? fmtScore(data.bestPipitScore, classifierMode) : "—"}`
                  : `${data.overallBestSpecies}${verifiedType ? ` · ${verifiedType}` : ""} · ${scoreLabel} ${verifiedDist != null ? fmtScore(verifiedDist, classifierMode) : "—"}`
              }
              audioUrl={verifiedUrl}
              type="verified"
            />
          )}
        </div>

      </div>
    </div>
  );
}
