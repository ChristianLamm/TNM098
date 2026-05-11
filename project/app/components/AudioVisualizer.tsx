"use client";
import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import Spectrogram from 'wavesurfer.js/dist/plugins/spectrogram.esm.js';

type Props = {
  audioUrl: string;
  title: string;
  type: 'kasios' | 'verified';
};

export default function AudioVisualizer({ audioUrl, title, type }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const specRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || !specRef.current) return;

    // Reset state when URL changes
    setIsReady(false);
    setIsPlaying(false);

    // Generate hot colormap (Black -> Red -> Yellow -> White)
    const colorMap = [];
    for (let i = 0; i < 256; i++) {
        let r = 0, g = 0, b = 0;
        if (i < 85) {
            r = Math.floor((i / 85) * 255);
        } else if (i < 170) {
            r = 255;
            g = Math.floor(((i - 85) / 85) * 255);
        } else {
            r = 255;
            g = 255;
            b = Math.floor(((i - 170) / 85) * 255);
        }
        colorMap.push([r, g, b, 1]); // Array of [r,g,b,a]
    }

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: type === 'kasios' ? '#fca5a5' : '#93c5fd', // Light Red / Light Blue
      progressColor: type === 'kasios' ? '#ef4444' : '#3b82f6', // Red / Blue
      cursorColor: '#ffffff',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      height: 60,
      url: audioUrl,
      plugins: [
        Spectrogram.create({
          container: specRef.current,
          labels: true,
          labelsBackground: 'rgba(0, 0, 0, 0.5)',
          labelsColor: '#fff',
          height: 140,
          colorMap: colorMap,
        }),
      ],
    });

    ws.on('ready', () => setIsReady(true));
    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));

    wavesurferRef.current = ws;

    return () => {
      ws.destroy();
    };
  }, [audioUrl, type]);

  const togglePlay = () => {
    if (wavesurferRef.current) {
      wavesurferRef.current.playPause();
    }
  };

  return (
    <div className="flex flex-col gap-2 p-4 bg-stone-900 rounded-xl shadow-lg relative border border-stone-800">
      <h3 className="font-bold text-white truncate px-1" title={title}>{title}</h3>
      
      <div className="relative w-full rounded-lg overflow-hidden border border-stone-700 bg-black">
        {/* Loading Overlay */}
        {!isReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-stone-900/90 z-20">
             <span className="text-stone-300 text-sm font-medium animate-pulse">Rendering Audio Overview...</span>
          </div>
        )}

        {/* Waveform Container */}
        <div className="w-full bg-stone-950 border-b border-stone-800" ref={containerRef} />
        
        {/* Spectrogram Container */}
        <div className="w-full bg-black" ref={specRef} />
      </div>
      
      {/* Controls */}
      <div className="flex justify-center mt-1">
        <button 
          onClick={togglePlay}
          disabled={!isReady}
          className="w-12 h-12 flex items-center justify-center bg-indigo-600 hover:bg-indigo-500 disabled:bg-stone-800 disabled:text-stone-600 disabled:cursor-not-allowed text-white rounded-full transition-colors shadow-md"
          title="Play/Pause"
        >
          {isPlaying ? (
             <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
          ) : (
             <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          )}
        </button>
      </div>
    </div>
  );
}
