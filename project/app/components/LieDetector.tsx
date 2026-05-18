"use client";

import { useEffect, useState } from "react";
import AudioVisualizer from "./AudioVisualizer";

type Prediction = {
  species: string;
  confidence: number;
  fid: string;
  distance: number;
  type: string;
};

type KasiosData = {
  predictions: Prediction[];
  bestPipitMatch: string;
  bestPipitScore: number;
  overallBestMatch: string;
  overallBestSpecies: string;
};

export default function LieDetector() {
  const [comparisons, setComparisons] = useState<Record<string, KasiosData>>({});
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [compareTarget, setCompareTarget] = useState<"pipit" | "actual">("pipit");

  useEffect(() => {
    fetch("/comparisons.json")
      .then(res => res.json())
      .then(data => {
        setComparisons(data);
        const keys = Object.keys(data).sort((a, b) => {
           const numA = parseInt(a.replace(/\D/g, ''));
           const numB = parseInt(b.replace(/\D/g, ''));
           return numA - numB;
        });
        if (keys.length > 0) setSelectedFile(keys[0]);
      })
      .catch(e => console.error("Error loading comparisons", e));
  }, []);

  if (!selectedFile || !comparisons[selectedFile]) return <div className="p-8 text-center text-stone-500 text-xl">Loading Classifier Data...</div>;

  const data = comparisons[selectedFile];
  const topPrediction = data.predictions[0];
  
  const verifiedId = compareTarget === "pipit" ? data.bestPipitMatch : data.overallBestMatch;
  const verifiedTitle = compareTarget === "pipit" 
    ? `Best Pipit Match (ID: ${verifiedId})` 
    : `Actual Species: ${data.overallBestSpecies} (ID: ${verifiedId})`;

  const kasiosUrl = `/api/audio?type=kasios&filename=${selectedFile}`;
  const verifiedUrl = `/api/audio?type=verified&id=${verifiedId}`;

  return (
    <div className="flex flex-col gap-6 p-6 bg-stone-50 rounded-xl shadow-lg border border-stone-200 mt-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-2xl font-bold text-stone-900 mb-1">Lie Detector (Species Classifier)</h2>
          <p className="text-stone-500 text-sm">Identifying the true identity of suspicious recordings using DTW and MFCC fingerprinting.</p>
        </div>
        
        <div className="flex gap-3 flex-wrap items-end">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider">Target Kasios File</span>
            <select 
              value={selectedFile}
              onChange={(e) => setSelectedFile(e.target.value)}
              className="bg-white border border-stone-300 text-stone-700 text-sm rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono shadow-sm cursor-pointer"
            >
              {Object.keys(comparisons).sort((a, b) => parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, ''))).map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1">
             <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider">Comparison Reference</span>
             <div className="bg-white p-1 rounded-lg flex border border-stone-300 shadow-sm">
               <button onClick={() => setCompareTarget("pipit")} className={`px-3 py-0.5 rounded-md text-sm font-medium transition-colors ${compareTarget === "pipit" ? "bg-red-600 text-white shadow-sm" : "text-stone-500 hover:text-stone-900"}`}>Claimed (Pipit)</button>
               <button onClick={() => setCompareTarget("actual")} className={`px-3 py-0.5 rounded-md text-sm font-medium transition-colors ${compareTarget === "actual" ? "bg-indigo-600 text-white shadow-sm" : "text-stone-500 hover:text-stone-900"}`}>Actual Species</button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Predictions List */}
        <div className="bg-white p-5 rounded-xl border border-stone-200 flex flex-col gap-4">
          <h3 className="font-bold text-stone-800 border-b pb-2">Classifier Results</h3>
          <div className="space-y-4">
            {data.predictions.slice(0, 3).map((p, idx) => (
              <div key={p.species} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className={`font-semibold ${idx === 0 ? 'text-indigo-600' : 'text-stone-700'}`}>{p.species}</span>
                  <span className="text-stone-500 font-mono">{p.confidence.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-stone-100 h-2 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-1000 ${idx === 0 ? 'bg-indigo-500' : 'bg-stone-300'}`} 
                    style={{ width: `${p.confidence}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 bg-indigo-50 rounded-lg border border-indigo-100">
            <p className="text-xs text-indigo-800 leading-relaxed">
              <strong>Verdict:</strong> {topPrediction.species === 'Rose-crested Blue Pipit' 
                ? "This recording likely belongs to a genuine Pipit." 
                : `This recording is 100% NOT a Pipit. It matches the ${topPrediction.species} with highest confidence.`}
            </p>
          </div>
        </div>

        {/* Center/Right: Audio Visualizers */}
        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
          <AudioVisualizer 
            key={`kasios-${selectedFile}`}
            title={`Kasios: ${selectedFile}`}
            audioUrl={kasiosUrl}
            type="kasios"
          />
          
          <AudioVisualizer 
            key={`verified-${verifiedId}`}
            title={verifiedTitle}
            audioUrl={verifiedUrl}
            type="verified"
          />
        </div>
      </div>
      
      <div className="text-sm text-stone-700 bg-amber-50/50 p-4 rounded-lg border border-amber-200 shadow-inner flex gap-3 items-start">
        <div className="bg-amber-100 p-2 rounded-full text-amber-600 shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        </div>
        <div>
          <strong className="text-amber-800 block mb-0.5">Environmental Detective Tip:</strong> 
          Use the <strong>"Actual Species"</strong> button to see how Recording 12 perfectly aligns with the Orange Pine Plover overview. Then switch to <strong>"Claimed (Pipit)"</strong> to see the massive structural mismatch. This visual evidence proves that Kasios submitted fake recordings to hide the Pipit's disappearance from the toxic dumping area.
        </div>
      </div>
    </div>
  );
}
