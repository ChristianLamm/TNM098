"use client";

import { useEffect, useState } from "react";
import AudioVisualizer from "./AudioVisualizer";

type KasiosData = {
  bestCall: string;
  bestCallScore: number;
  worstCall: string;
  worstCallScore: number;
  bestSong: string;
  bestSongScore: number;
  worstSong: string;
  worstSongScore: number;
};

export default function LieDetector() {
  const [comparisons, setComparisons] = useState<Record<string, KasiosData>>({});
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [compareType, setCompareType] = useState<"bestCall" | "worstCall" | "bestSong" | "worstSong">("bestCall");

  useEffect(() => {
    fetch("/comparisons.json")
      .then(res => res.json())
      .then(data => {
        setComparisons(data);
        const keys = Object.keys(data).sort((a, b) => {
           // Sort naturally like "1.mp3", "2.mp3", "10.mp3"
           const numA = parseInt(a.replace(/\D/g, ''));
           const numB = parseInt(b.replace(/\D/g, ''));
           return numA - numB;
        });
        if (keys.length > 0) setSelectedFile(keys[0]);
      })
      .catch(e => console.error("Error loading comparisons", e));
  }, []);

  if (!selectedFile || !comparisons[selectedFile]) return <div className="p-8 text-center text-stone-500 text-xl">Loading Lie Detector Data...</div>;

  const data = comparisons[selectedFile];
  const verifiedId = data[compareType];
  const score = data[`${compareType}Score`];

  const kasiosUrl = `/api/audio?type=kasios&filename=${selectedFile}`;
  const verifiedUrl = `/api/audio?type=verified&id=${verifiedId}`;

  return (
    <div className="flex flex-col gap-6 p-6 bg-stone-50 rounded-xl shadow-lg border border-stone-200 mt-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-2xl font-bold text-stone-900 mb-1">Lie Detector (Audio Analysis)</h2>
          <p className="text-stone-500 text-sm">Visually compare Kasios recordings against their mathematically closest baseline matches.</p>
        </div>
        
        <div className="flex gap-3 flex-wrap">
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
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider">Comparison Mode</span>
            <select 
              value={compareType}
              onChange={(e) => setCompareType(e.target.value as any)}
              className="bg-white border border-stone-300 text-stone-700 text-sm rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm cursor-pointer"
            >
              <option value="bestCall">Best Match (Call)</option>
              <option value="worstCall">Worst Match (Call)</option>
              <option value="bestSong">Best Match (Song)</option>
              <option value="worstSong">Worst Match (Song)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-white p-5 rounded-xl border border-stone-200">
        <AudioVisualizer 
          key={`kasios-${selectedFile}`}
          title={`Kasios Recording: ${selectedFile}`}
          audioUrl={kasiosUrl}
          type="kasios"
        />
        
        <AudioVisualizer 
          key={`verified-${verifiedId}`}
          title={`Baseline: ID ${verifiedId} (Score: ${Math.round(score)})`}
          audioUrl={verifiedUrl}
          type="verified"
        />
      </div>
      
      <div className="text-sm text-stone-700 bg-amber-50/50 p-4 rounded-lg border border-amber-200 shadow-inner">
        <strong className="text-amber-800">Analysis Guide:</strong> A genuine recording should have closely matching frequency peaks (spectrogram) and temporal shape (waveform) compared to its <strong>Best Match</strong>. Significant visual divergence, especially in the high/low frequency bands or structural cadence, visually proves the Kasios file is manipulated or a completely different species. Playback cursors help you match visual peaks to specific audio events.
      </div>
    </div>
  );
}
