"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";

type BirdData = {
  "File ID": number;
  English_name: string;
  X: number;
  Y: number;
  YearMonth: string;
  Year: number;
  Month: number;
  Type: string;
};

export default function MapDashboard() {
  const mapRef = useRef<SVGSVGElement>(null);
  const [data, setData] = useState<BirdData[]>([]);
  const [uniqueMonths, setUniqueMonths] = useState<string[]>([]);
  const [uniqueSpecies, setUniqueSpecies] = useState<string[]>([]);
  
  // State for controls
  const [startMonthIndex, setStartMonthIndex] = useState(0);
  const [endMonthIndex, setEndMonthIndex] = useState(0);
  const [selectedSpecies, setSelectedSpecies] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"scatter" | "heatmap">("scatter");
  const [filterType, setFilterType] = useState<"all" | "call" | "song" | "both">("all");
  const [isPlaying, setIsPlaying] = useState(false);

  // Load Data
  useEffect(() => {
    fetch("/map_data.json")
      .then((res) => res.json())
      .then((json: BirdData[]) => {
        setData(json);
        const months = Array.from(new Set(json.map((d) => d.YearMonth))).sort();
        const species = Array.from(new Set(json.map((d) => d.English_name))).sort();
        setUniqueMonths(months);
        setUniqueSpecies(species);
        // By default select all species
        setSelectedSpecies(new Set(species));
        setStartMonthIndex(0);
        setEndMonthIndex(months.length > 0 ? months.length - 1 : 0); // Show all time by default
      });
  }, []);

  // Play animation effect
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying) {
      interval = setInterval(() => {
        setEndMonthIndex((prevEnd) => {
          if (prevEnd >= uniqueMonths.length - 1) {
            setIsPlaying(false);
            return prevEnd;
          }
          return prevEnd + 1;
        });
      }, 500);
    }
    return () => clearInterval(interval);
  }, [isPlaying, uniqueMonths.length]);

  const toggleSpecies = (species: string) => {
    const newSet = new Set(selectedSpecies);
    if (newSet.has(species)) {
      newSet.delete(species);
    } else {
      newSet.add(species);
    }
    setSelectedSpecies(newSet);
  };

  const selectAllSpecies = () => setSelectedSpecies(new Set(uniqueSpecies));
  const clearSpecies = () => setSelectedSpecies(new Set());

  // Draw Map with D3
  useEffect(() => {
    if (!data.length || !uniqueMonths.length || !mapRef.current) return;

    const svg = d3.select(mapRef.current);
    const width = 800;
    const height = 800;
    
    svg.selectAll("*").remove();
    
    const defs = svg.append("defs");
    const filter = defs.append("filter").attr("id", "blur-filter");
    filter.append("feGaussianBlur").attr("stdDeviation", 4);

    const xScale = d3.scaleLinear().domain([0, 200]).range([0, width]);
    const yScaleImage = d3.scaleLinear().domain([0, 200]).range([0, height]);

    // Color Scale for different birds
    const colorScale = d3.scaleOrdinal(d3.schemeCategory10).domain(uniqueSpecies);

    // Shape Generator
    const symbolGenerator = d3.symbol();
    const getShape = (type: string) => {
      if (type === 'call') return d3.symbolCircle;
      if (type === 'song') return d3.symbolTriangle;
      return d3.symbolSquare; // both
    };

    // Filter data
    let filteredData = data.filter((d) => {
      const dIndex = uniqueMonths.indexOf(d.YearMonth);
      return dIndex >= startMonthIndex && dIndex <= endMonthIndex;
    });

    filteredData = filteredData.filter((d) => selectedSpecies.has(d.English_name));

    if (filterType !== "all") {
      filteredData = filteredData.filter((d) => d.Type === filterType);
    }

    const g = svg.append("g");

    if (viewMode === "scatter") {
      // Scatterplot using Paths for different shapes
      g.selectAll("path")
        .data(filteredData, (d: any) => d["File ID"])
        .join(
          enter => enter.append("path")
            .attr("transform", d => `translate(${xScale(d.X)}, ${yScaleImage(200 - d.Y)}) scale(0)`)
            .attr("d", d => symbolGenerator.type(getShape(d.Type)).size(100)()!)
            .attr("fill", d => colorScale(d.English_name))
            .attr("opacity", 0.8)
            .attr("stroke", "#fff")
            .attr("stroke-width", 1)
            .call(enter => enter.transition().duration(300).attr("transform", d => `translate(${xScale(d.X)}, ${yScaleImage(200 - d.Y)}) scale(1)`)),
          update => update
            .attr("fill", d => colorScale(d.English_name))
            .attr("d", d => symbolGenerator.type(getShape(d.Type)).size(100)()!),
          exit => exit.transition().duration(300).attr("transform", d => `translate(${xScale(d.X)}, ${yScaleImage(200 - d.Y)}) scale(0)`).remove()
        );
    } else {
      // Heatmap
      g.selectAll("circle")
        .data(filteredData, (d: any) => d["File ID"])
        .join(
          enter => enter.append("circle")
            .attr("cx", d => xScale(d.X))
            .attr("cy", d => yScaleImage(200 - d.Y))
            .attr("r", 0)
            .attr("fill", "#f59e0b")
            .attr("opacity", 0)
            .attr("filter", "url(#blur-filter)")
            .style("mix-blend-mode", "multiply")
            .call(enter => enter.transition().duration(300).attr("r", 20).attr("opacity", 0.4)),
          update => update,
          exit => exit.transition().duration(300).attr("r", 0).attr("opacity", 0).remove()
        );
    }

  }, [data, uniqueMonths, startMonthIndex, endMonthIndex, selectedSpecies, viewMode, filterType, uniqueSpecies]);

  if (!uniqueMonths.length) return <div className="p-8 text-center text-stone-500 text-xl">Loading Spatiotemporal Data...</div>;

  return (
    <div className="flex flex-col md:flex-row gap-6 items-start max-w-[1100px] mx-auto">
      {/* Sidebar Controls */}
      <div className="w-full md:w-80 flex flex-col gap-5 bg-white p-5 rounded-xl shadow-lg border border-stone-200">
        
        <div>
          <h2 className="text-xl font-bold text-stone-900">Filters</h2>
          <p className="text-stone-500 text-sm mb-3">Filter by species and sounds</p>
          
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-semibold text-stone-700">Bird Species</span>
            <div className="space-x-2">
              <button onClick={selectAllSpecies} className="text-xs text-indigo-600 hover:underline">All</button>
              <button onClick={clearSpecies} className="text-xs text-stone-500 hover:underline">None</button>
            </div>
          </div>
          
          <div className="h-48 overflow-y-auto border border-stone-200 rounded-md p-2 bg-stone-50 text-sm space-y-1">
            {uniqueSpecies.map(s => (
              <label key={s} className="flex items-center gap-2 cursor-pointer hover:bg-stone-100 p-1 rounded">
                <input 
                  type="checkbox" 
                  checked={selectedSpecies.has(s)} 
                  onChange={() => toggleSpecies(s)}
                  className="rounded text-indigo-600 focus:ring-indigo-500"
                />
                <span className="flex-1 truncate" title={s}>{s}</span>
                {/* Tiny color indicator for scatter mode */}
                {viewMode === "scatter" && (
                  <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: d3.scaleOrdinal(d3.schemeCategory10).domain(uniqueSpecies)(s) }}></span>
                )}
              </label>
            ))}
          </div>
        </div>

        <div>
          <span className="text-sm font-semibold text-stone-700 block mb-2">Vocalization Type</span>
          <div className="flex flex-wrap gap-2">
             <button onClick={() => setFilterType("all")} className={`px-3 py-1 rounded-md text-sm font-medium transition-colors border ${filterType === "all" ? "bg-stone-800 text-white border-stone-800 shadow-sm" : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"}`}>All Types</button>
             <button onClick={() => setFilterType("call")} className={`px-3 py-1 rounded-md text-sm font-medium transition-colors border flex items-center gap-2 ${filterType === "call" ? "bg-stone-800 text-white border-stone-800 shadow-sm" : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"}`}>
               <span className="w-2.5 h-2.5 rounded-full border border-current bg-transparent"></span> Calls
             </button>
             <button onClick={() => setFilterType("song")} className={`px-3 py-1 rounded-md text-sm font-medium transition-colors border flex items-center gap-2 ${filterType === "song" ? "bg-stone-800 text-white border-stone-800 shadow-sm" : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"}`}>
               <span className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-b-[9px] border-b-current"></span> Songs
             </button>
             <button onClick={() => setFilterType("both")} className={`px-3 py-1 rounded-md text-sm font-medium transition-colors border flex items-center gap-2 ${filterType === "both" ? "bg-stone-800 text-white border-stone-800 shadow-sm" : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"}`}>
               <span className="w-2.5 h-2.5 border border-current bg-transparent"></span> Both
             </button>
          </div>
        </div>

        <div>
          <span className="text-sm font-semibold text-stone-700 block mb-2">View Mode</span>
          <div className="flex gap-2">
             <button onClick={() => setViewMode("scatter")} className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors border ${viewMode === "scatter" ? "bg-indigo-600 text-white border-indigo-600 shadow-sm" : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"}`}>Scatter (Dots)</button>
             <button onClick={() => setViewMode("heatmap")} className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors border ${viewMode === "heatmap" ? "bg-amber-500 text-white border-amber-500 shadow-sm" : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"}`}>Heatmap</button>
          </div>
          {viewMode === "heatmap" && (
            <p className="text-xs text-stone-500 mt-2">
              Note: The heatmap visualizes the combined spatial density of all selected birds. Color indicates density, not species.
            </p>
          )}
        </div>
      </div>

      {/* Main Map Area */}
      <div className="flex-1 flex flex-col gap-4 bg-white p-5 rounded-xl shadow-lg border border-stone-200 w-full">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold text-stone-900">Geospatial Distribution</h2>
          <p className="text-stone-700 font-mono font-bold bg-stone-100 px-3 py-1 rounded-md border border-stone-200 text-sm">
            {uniqueMonths[startMonthIndex]} <span className="text-stone-400">→</span> {uniqueMonths[endMonthIndex]}
          </p>
        </div>

        <div className="relative w-full aspect-square border-2 border-stone-300 rounded-lg overflow-hidden bg-stone-100 shadow-inner max-h-[600px]">
          <img 
            src="/map_background.bmp" 
            alt="Lekagul Roadways Map" 
            className="absolute inset-0 w-full h-full object-cover opacity-80"
            style={{ imageRendering: "pixelated" }}
          />
          <svg 
            ref={mapRef} 
            viewBox="0 0 800 800" 
            className="absolute inset-0 w-full h-full z-10"
          />
        </div>

        <div className="flex flex-col gap-3 bg-stone-50 p-4 rounded-lg border border-stone-200 mt-2">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsPlaying(!isPlaying)}
              className="w-10 h-10 flex items-center justify-center bg-indigo-600 hover:bg-indigo-500 text-white rounded-full transition-colors shrink-0 shadow-sm"
              title="Play Timeline"
            >
              {isPlaying ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
              ) : (
                 <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              )}
            </button>
            
            <div className="flex flex-col flex-1 gap-3">
              {/* Distinct Start and End Sliders to fix overlap issues */}
              <div className="flex items-center gap-3 text-sm">
                <span className="w-10 text-stone-500 font-medium">Start</span>
                <input 
                  type="range" 
                  min="0" 
                  max={uniqueMonths.length - 1} 
                  value={startMonthIndex} 
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    setStartMonthIndex(Math.min(val, endMonthIndex));
                  }}
                  className="w-full h-2 bg-stone-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="w-10 text-stone-500 font-medium">End</span>
                <input 
                  type="range" 
                  min="0" 
                  max={uniqueMonths.length - 1} 
                  value={endMonthIndex} 
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    setEndMonthIndex(Math.max(val, startMonthIndex));
                  }}
                  className="w-full h-2 bg-stone-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
