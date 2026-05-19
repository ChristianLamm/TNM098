"use client";

import { useEffect, useRef, useState, useMemo } from "react";
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

type Tooltip = { x: number; y: number; bird: BirdData } | null;

const W = 800;
const H = 800;
const xSc = d3.scaleLinear().domain([0, 200]).range([0, W]);
const ySc = d3.scaleLinear().domain([0, 200]).range([0, H]);
const sym = d3.symbol();

function shapeFor(type: string) {
  if (type === "call") return d3.symbolCircle;
  if (type === "song") return d3.symbolTriangle;
  return d3.symbolSquare;
}

type MapViewState = {
  selYear: number | "all";
  startIdx: number;
  endIdx: number;
  selSpecies: Set<string>;
  typeFilter: "all" | "call" | "song" | "both";
  playing: boolean;
};

type MapViewRefs = {
  svgRef: React.RefObject<SVGSVGElement>;
  gRef: React.MutableRefObject<d3.Selection<
    SVGGElement,
    unknown,
    null,
    undefined
  > | null>;
  colorRef: React.MutableRefObject<d3.ScaleOrdinal<string, string> | null>;
};

export default function MapDashboard() {
  // Main map refs
  const mainSvgRef = useRef<SVGSVGElement>(null);
  const mainGRef = useRef<d3.Selection<
    SVGGElement,
    unknown,
    null,
    undefined
  > | null>(null);
  const mainColorRef = useRef<d3.ScaleOrdinal<string, string> | null>(null);

  // Comparison map refs
  const compSvgRef = useRef<SVGSVGElement>(null);
  const compGRef = useRef<d3.Selection<
    SVGGElement,
    unknown,
    null,
    undefined
  > | null>(null);
  const compColorRef = useRef<d3.ScaleOrdinal<string, string> | null>(null);

  const [data, setData] = useState<BirdData[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [species, setSpecies] = useState<string[]>([]);
  const [years, setYears] = useState<number[]>([]);

  // Main map state
  const [selYear, setSelYear] = useState<number | "all">("all");
  const [startIdx, setStartIdx] = useState(0);
  const [endIdx, setEndIdx] = useState(0);
  const [selSpecies, setSelSpecies] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"scatter" | "heatmap">("scatter");
  const [mapStyle, setMapStyle] = useState<"standard" | "realistic">(
    "standard",
  );
  const [typeFilter, setTypeFilter] = useState<
    "all" | "call" | "song" | "both"
  >("all");
  const [playing, setPlaying] = useState(false);
  const [tooltip, setTooltip] = useState<Tooltip>(null);

  // Comparison map state
  const [showComparison, setShowComparison] = useState(false);
  const [compSelYear, setCompSelYear] = useState<number | "all">("all");
  const [compStartIdx, setCompStartIdx] = useState(0);
  const [compEndIdx, setCompEndIdx] = useState(0);
  const [compPlaying, setCompPlaying] = useState(false);

  const maxIdx = months.length - 1;
  const minPercent = maxIdx > 0 ? (startIdx / maxIdx) * 100 : 0;
  const maxPercent = maxIdx > 0 ? (endIdx / maxIdx) * 100 : 0;

  const compMinPercent = maxIdx > 0 ? (compStartIdx / maxIdx) * 100 : 0;
  const compMaxPercent = maxIdx > 0 ? (compEndIdx / maxIdx) * 100 : 0;

  const monthMap = useMemo(() => {
    const m = new Map<string, number>();
    months.forEach((v, i) => m.set(v, i));
    return m;
  }, [months]);

  const colorScale = useMemo(
    () => d3.scaleOrdinal<string>(d3.schemeCategory10).domain(species),
    [species],
  );

  // Helper function to create a filter for either main or comparison map
  const makeFilterData = (
    selYear: number | "all",
    startIdx: number,
    endIdx: number,
    selSpecies: Set<string>,
    typeFilter: "all" | "call" | "song" | "both",
  ) => {
    return (d: BirdData) => {
      const i = monthMap.get(d.YearMonth) ?? -1;
      const matchesTime =
        selYear === "all" ? i >= startIdx && i <= endIdx : d.Year === selYear;
      const matchesType =
        typeFilter === "all"
          ? true
          : typeFilter === "both"
            ? d.Type === "call" || d.Type === "song"
            : d.Type === typeFilter;
      return matchesTime && matchesType && selSpecies.has(d.English_name);
    };
  };

  const filterData = makeFilterData(
    selYear,
    startIdx,
    endIdx,
    selSpecies,
    typeFilter,
  );
  const compFilterData = makeFilterData(
    compSelYear,
    compStartIdx,
    compEndIdx,
    selSpecies,
    typeFilter,
  );

  const sightingCount = useMemo(
    () => data.filter(filterData).length,
    [data, monthMap, startIdx, endIdx, selSpecies, selYear, typeFilter],
  );

  const compSightingCount = useMemo(
    () => data.filter(compFilterData).length,
    [
      data,
      monthMap,
      compStartIdx,
      compEndIdx,
      selSpecies,
      compSelYear,
      typeFilter,
    ],
  );

  // Load data
  useEffect(() => {
    fetch("/map_data.json")
      .then((r) => r.json())
      .then((json: BirdData[]) => {
        setData(json);
        const ms = Array.from(new Set(json.map((d) => d.YearMonth))).sort();
        const sp = Array.from(new Set(json.map((d) => d.English_name))).sort();

        // FIX 1: Hämta år direkt från d.Year istället för sträng-splitting
        const yr = Array.from(new Set(json.map((d) => d.Year)))
          .filter((y) => y !== undefined && !isNaN(y))
          .sort((a, b) => a - b);

        setMonths(ms);
        setSpecies(sp);
        setYears(yr);
        setSelSpecies(new Set(sp));
        setStartIdx(0);
        setEndIdx(ms.length - 1);
        setCompStartIdx(0);
        setCompEndIdx(ms.length - 1);
      });
  }, []);

  // Play animation - main map
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setEndIdx((p) => {
        if (p >= months.length - 1) {
          setPlaying(false);
          return p;
        }
        return p + 1;
      });
    }, 600);
    return () => clearInterval(id);
  }, [playing, months.length]);

  // Play animation - comparison map
  useEffect(() => {
    if (!compPlaying) return;
    const id = setInterval(() => {
      setCompEndIdx((p) => {
        if (p >= months.length - 1) {
          setCompPlaying(false);
          return p;
        }
        return p + 1;
      });
    }, 600);
    return () => clearInterval(id);
  }, [compPlaying, months.length]);

  // ONE-TIME SVG SETUP - Main map
  useEffect(() => {
    if (!data.length || !species.length || !mainSvgRef.current) return;
    const svg = d3.select(mainSvgRef.current);
    svg.selectAll("*").remove();
    svg
      .append("defs")
      .append("filter")
      .attr("id", "blur")
      .append("feGaussianBlur")
      .attr("stdDeviation", 4);
    mainColorRef.current = d3
      .scaleOrdinal<string>(d3.schemeCategory10)
      .domain(species);
    mainGRef.current = svg.append("g");
  }, [data, species]);

  // ONE-TIME SVG SETUP - Comparison map
  useEffect(() => {
    if (
      !showComparison ||
      !data.length ||
      !species.length ||
      !compSvgRef.current
    )
      return;
    const svg = d3.select(compSvgRef.current);
    svg.selectAll("*").remove();
    svg
      .append("defs")
      .append("filter")
      .attr("id", "blur-comp")
      .append("feGaussianBlur")
      .attr("stdDeviation", 4);
    compColorRef.current = d3
      .scaleOrdinal<string>(d3.schemeCategory10)
      .domain(species);
    compGRef.current = svg.append("g");
  }, [showComparison, data, species]);

  // Helper function to render map data
  const renderMapData = (
    g: d3.Selection<SVGGElement, unknown, null, undefined> | null,
    color: d3.ScaleOrdinal<string, string> | null,
    filtered: BirdData[],
  ) => {
    if (!g || !color) return;

    if (viewMode === "scatter") {
      g.selectAll("circle.hm").remove();

      g.selectAll<SVGPathElement, BirdData>("path.dot")
        .data(filtered, (d) => d["File ID"])
        .join(
          (enter) =>
            enter
              .append("path")
              .attr("class", "dot")
              .attr(
                "transform",
                (d) => `translate(${xSc(d.X)},${ySc(200 - d.Y)}) scale(0)`,
              )
              .attr("d", (d) => sym.type(shapeFor(d.Type)).size(80)()!)
              .attr("fill", (d) => color(d.English_name))
              .attr("opacity", 0.85)
              .attr("stroke", "#fff")
              .attr("stroke-width", 0.8)
              .style("cursor", "pointer")
              .on("mouseover", (event, d) =>
                setTooltip({
                  x: (event as MouseEvent).clientX,
                  y: (event as MouseEvent).clientY,
                  bird: d,
                }),
              )
              .on("mouseout", () => setTooltip(null))
              .call((sel) =>
                sel
                  .transition()
                  .duration(200)
                  .attr(
                    "transform",
                    (d) => `translate(${xSc(d.X)},${ySc(200 - d.Y)}) scale(1)`,
                  ),
              ),
          (update) =>
            update
              .attr("d", (d) => sym.type(shapeFor(d.Type)).size(80)()!)
              .attr("fill", (d) => color(d.English_name)),
          (exit) =>
            exit
              .transition()
              .duration(150)
              .attr(
                "transform",
                (d) => `translate(${xSc(d.X)},${ySc(200 - d.Y)}) scale(0)`,
              )
              .remove(),
        );
    } else {
      g.selectAll("path.dot").remove();

      g.selectAll<SVGCircleElement, BirdData>("circle.hm")
        .data(filtered, (d) => d["File ID"])
        .join(
          (enter) =>
            enter
              .append("circle")
              .attr("class", "hm")
              .attr("cx", (d) => xSc(d.X))
              .attr("cy", (d) => ySc(200 - d.Y))
              .attr("r", 0)
              .attr("opacity", 0)
              .attr("fill", "#f59e0b")
              .attr("filter", "url(#blur)")
              .style("mix-blend-mode", "multiply")
              .call((sel) =>
                sel
                  .transition()
                  .duration(200)
                  .attr("r", 20)
                  .attr("opacity", 0.4),
              ),
          (update) => update,
          (exit) =>
            exit
              .transition()
              .duration(150)
              .attr("r", 0)
              .attr("opacity", 0)
              .remove(),
        );
    }
  };

  // DATA JOIN - Main map
  useEffect(() => {
    const filtered = data.filter(filterData);
    renderMapData(mainGRef.current, mainColorRef.current, filtered);
  }, [
    data,
    months,
    monthMap,
    startIdx,
    endIdx,
    selSpecies,
    selYear,
    viewMode,
    typeFilter,
  ]);

  // DATA JOIN - Comparison map
  useEffect(() => {
    if (!showComparison) return;
    const filtered = data.filter(compFilterData);
    renderMapData(compGRef.current, compColorRef.current, filtered);
  }, [
    showComparison,
    data,
    months,
    monthMap,
    compStartIdx,
    compEndIdx,
    selSpecies,
    compSelYear,
    typeFilter,
    viewMode,
  ]);

  if (!months.length)
    return (
      <div className="p-8 text-center text-stone-500 text-xl">
        Loading Spatiotemporal Data...
      </div>
    );

  return (
    <>
      {tooltip && (
        <div
          className="fixed z-50 bg-stone-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl pointer-events-none"
          style={{ left: tooltip.x + 14, top: tooltip.y - 10 }}
        >
          <p className="font-semibold">{tooltip.bird.English_name}</p>
          <p className="text-stone-300">
            {tooltip.bird.YearMonth} ·{" "}
            <span className="capitalize">{tooltip.bird.Type}</span>
          </p>
        </div>
      )}

      <div
        className={`flex flex-col md:flex-row gap-0 items-start ${showComparison ? "w-full" : "max-w-[1100px] mx-auto"}`}
      >
        {/* Sidebar Controls */}
        <div
          className={`${showComparison ? "w-64 bg-white p-4 rounded-none shadow-none border-r border-stone-200" : "w-full md:w-72 bg-white p-5 rounded-xl shadow-lg border border-stone-200"} flex flex-col gap-5 shrink-0`}
        >
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-semibold text-stone-700">
                Bird Species{" "}
                <span className="text-stone-400 font-normal text-xs">
                  ({selSpecies.size}/{species.length})
                </span>
              </span>
              <div className="space-x-2">
                <button
                  onClick={() => setSelSpecies(new Set(species))}
                  className="text-xs text-indigo-600 hover:underline"
                >
                  All
                </button>
                <button
                  onClick={() => setSelSpecies(new Set())}
                  className="text-xs text-stone-500 hover:underline"
                >
                  None
                </button>
              </div>
            </div>

            <div className="h-52 overflow-y-auto border border-stone-200 rounded-md p-2 bg-stone-50 text-sm space-y-0.5">
              {species.map((s) => (
                <label
                  key={s}
                  className="flex items-center gap-2 cursor-pointer hover:bg-stone-100 px-1 py-1 rounded"
                >
                  <input
                    type="checkbox"
                    checked={selSpecies.has(s)}
                    onChange={() => {
                      const next = new Set(selSpecies);
                      next.has(s) ? next.delete(s) : next.add(s);
                      setSelSpecies(next);
                    }}
                    className="rounded text-indigo-600 focus:ring-indigo-500 shrink-0"
                  />
                  <span className="flex-1 truncate text-xs" title={s}>
                    {s}
                  </span>
                  {viewMode === "scatter" && (
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: colorScale(s) }}
                    />
                  )}
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  { key: "all", label: "All Types" },
                  { key: "call", label: "Call" },
                  { key: "song", label: "Song" },
                  { key: "both", label: "Call + Song" },
                ] as const
              ).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setTypeFilter(key)}
                  className={`px-2 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                    typeFilter === key
                      ? "bg-stone-800 text-white border-stone-800 shadow-sm"
                      : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="text-sm font-semibold text-stone-700 block mb-2">
              View Mode
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setViewMode("scatter")}
                className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors border ${
                  viewMode === "scatter"
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"
                }`}
              >
                Scatter
              </button>
              <button
                onClick={() => setViewMode("heatmap")}
                className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors border ${
                  viewMode === "heatmap"
                    ? "bg-amber-500 text-white border-amber-500"
                    : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"
                }`}
              >
                Heatmap
              </button>
            </div>
          </div>

          {viewMode === "scatter" && (
            <div className="border-t border-stone-100 pt-3 space-y-1.5">
              <span className="text-xs font-medium text-stone-600">
                Marker shapes
              </span>
              <div className="flex gap-4 text-xs text-stone-500">
                <span className="flex items-center gap-1.5">
                  <svg width="10" height="10">
                    <circle cx="5" cy="5" r="4" fill="#64748b" />
                  </svg>
                  Call
                </span>
                <span className="flex items-center gap-1.5">
                  <svg width="10" height="10">
                    <polygon points="5,1 9,9 1,9" fill="#64748b" />
                  </svg>
                  Song
                </span>
                <span className="flex items-center gap-1.5">
                  <svg width="10" height="10">
                    <rect x="1" y="1" width="8" height="8" fill="#64748b" />
                  </svg>
                  Both
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Main Map Area */}
        <div className="flex-1 flex flex-col gap-4 bg-white p-5 rounded-xl shadow-lg border border-stone-200 min-w-0">
          <div className="flex justify-between items-center gap-3 flex-wrap">
            <h2 className="text-xl font-bold text-stone-900">
              Geospatial Distribution
            </h2>
            <div className="flex items-center gap-3">
              <button
                onClick={() =>
                  setMapStyle((prev) =>
                    prev === "standard" ? "realistic" : "standard",
                  )
                }
                className="text-xs font-medium bg-stone-100 hover:bg-stone-200 text-stone-700 px-3 py-1.5 rounded-md border border-stone-200 transition-colors shadow-sm"
              >
                {mapStyle === "standard"
                  ? "Switch to Realistic Map"
                  : "Switch to Standard Map"}
              </button>
              <span className="text-stone-400 text-sm">
                {sightingCount.toLocaleString()} sightings
              </span>
              <select
                value={selYear}
                onChange={(e) =>
                  setSelYear(e.target.value === "all" ? "all" : +e.target.value)
                }
                className="px-3 py-1.5 rounded-md border border-stone-200 bg-white text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium shadow-sm"
              >
                <option value="all">All Years</option>
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setShowComparison(!showComparison)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                  showComparison
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                    : "bg-stone-100 hover:bg-stone-200 text-stone-700 border-stone-200 shadow-sm"
                }`}
              >
                Compare
              </button>
            </div>
          </div>

          <div
            className={`relative mx-auto aspect-square border-2 border-stone-300 rounded-lg overflow-hidden bg-stone-100 shadow-inner ${showComparison ? "w-full" : "w-full max-w-[600px]"}`}
          >
            <img
              src={
                mapStyle === "standard"
                  ? "/map_background.bmp"
                  : "/realisticMap.png"
              }
              alt="Lekagul Roadways Map"
              className={`absolute inset-0 w-full h-full object-cover transition-all duration-300 ${
                mapStyle === "standard" ? "opacity-80" : "opacity-100"
              }`}
              style={{
                imageRendering: mapStyle === "standard" ? "pixelated" : "auto",
              }}
            />
            <svg
              ref={mainSvgRef}
              viewBox="0 0 800 800"
              className="absolute inset-0 w-full h-full z-10"
            />
          </div>

          {/* Timeline controls */}
          <div
            className={`flex flex-col gap-2 bg-stone-50 p-4 rounded-lg border border-stone-200 transition-opacity ${selYear !== "all" ? "opacity-40 pointer-events-none" : ""}`}
          >
            <div className="flex items-center gap-3">
              <button
                disabled={selYear !== "all"}
                onClick={() => {
                  if (!playing && endIdx >= months.length - 1)
                    setEndIdx(startIdx);
                  setPlaying((p) => !p);
                }}
                className="w-9 h-9 flex items-center justify-center bg-indigo-600 hover:bg-indigo-500 text-white rounded-full transition-colors shrink-0 shadow-sm disabled:bg-stone-300"
                title={playing ? "Pause" : "Animate timeline"}
              >
                {playing ? (
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                  </svg>
                ) : (
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>

              <div className="flex flex-col flex-1 gap-1 min-w-0">
                <div className="flex justify-between text-xs text-stone-500 px-1 select-none">
                  <div>
                    From:{" "}
                    <span className="text-stone-600 font-mono">
                      {months[startIdx]}
                    </span>
                  </div>
                  <div>
                    To:{" "}
                    <span className="text-stone-600 font-mono">
                      {months[endIdx]}
                    </span>
                  </div>
                </div>

                <div className="relative w-full h-5 flex items-center min-w-0">
                  <div className="absolute left-0 right-0 h-1.5 bg-stone-200 rounded-lg z-0" />
                  <div
                    className="absolute h-1.5 bg-indigo-600 rounded-lg z-10"
                    style={{
                      left: `${minPercent}%`,
                      right: `${100 - maxPercent}%`,
                    }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={maxIdx}
                    value={startIdx}
                    disabled={selYear !== "all"}
                    onChange={(e) =>
                      setStartIdx(Math.min(+e.target.value, endIdx))
                    }
                    className="absolute w-full h-1.5 appearance-none bg-transparent pointer-events-none cursor-pointer z-20 min-w-0
                    [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-600 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow"
                  />
                  <input
                    type="range"
                    min={0}
                    max={maxIdx}
                    value={endIdx}
                    disabled={selYear !== "all"}
                    onChange={(e) =>
                      setEndIdx(Math.max(+e.target.value, startIdx))
                    }
                    className="absolute w-full h-1.5 appearance-none bg-transparent pointer-events-none cursor-pointer z-20 min-w-0
                    [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-600 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Comparison Map Area */}
        {showComparison && (
          <div className="flex-1 flex flex-col gap-4 bg-white p-4 rounded-none shadow-none border-stone-200 min-w-0">
            <div className="flex justify-between items-center gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold text-stone-900">Comparison</h2>
                <button
                  onClick={() => setShowComparison(false)}
                  className="w-6 h-6 flex items-center justify-center text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded transition-colors"
                  title="Close comparison view"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() =>
                    setMapStyle((prev) =>
                      prev === "standard" ? "realistic" : "standard",
                    )
                  }
                  className="text-xs font-medium bg-stone-100 hover:bg-stone-200 text-stone-700 px-3 py-1.5 rounded-md border border-stone-200 transition-colors shadow-sm"
                >
                  {mapStyle === "standard"
                    ? "Switch to Realistic Map"
                    : "Switch to Standard Map"}
                </button>
                <span className="text-stone-400 text-sm">
                  {compSightingCount.toLocaleString()} sightings
                </span>
                <select
                  value={compSelYear}
                  onChange={(e) =>
                    setCompSelYear(
                      e.target.value === "all" ? "all" : +e.target.value,
                    )
                  }
                  className="px-3 py-1.5 rounded-md border border-stone-200 bg-white text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium shadow-sm"
                >
                  <option value="all">All Years</option>
                  {years.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="relative w-full aspect-square border-2 border-stone-300 rounded-lg overflow-hidden bg-stone-100 shadow-inner">
              <img
                src={
                  mapStyle === "standard"
                    ? "/map_background.bmp"
                    : "/realisticMap.png"
                }
                alt="Lekagul Roadways Map"
                className={`absolute inset-0 w-full h-full object-cover transition-all duration-300 ${
                  mapStyle === "standard" ? "opacity-80" : "opacity-100"
                }`}
                style={{
                  imageRendering:
                    mapStyle === "standard" ? "pixelated" : "auto",
                }}
              />
              <svg
                ref={compSvgRef}
                viewBox="0 0 800 800"
                className="absolute inset-0 w-full h-full z-10"
              />
            </div>

            {/* Timeline controls - Comparison */}
            <div
              className={`flex flex-col gap-2 bg-stone-50 p-4 rounded-lg border border-stone-200 transition-opacity ${compSelYear !== "all" ? "opacity-40 pointer-events-none" : ""}`}
            >
              <div className="flex items-center gap-3">
                <button
                  disabled={compSelYear !== "all"}
                  onClick={() => {
                    if (!compPlaying && compEndIdx >= months.length - 1)
                      setCompEndIdx(compStartIdx);
                    setCompPlaying((p) => !p);
                  }}
                  className="w-9 h-9 flex items-center justify-center bg-indigo-600 hover:bg-indigo-500 text-white rounded-full transition-colors shrink-0 shadow-sm disabled:bg-stone-300"
                  title={compPlaying ? "Pause" : "Animate timeline"}
                >
                  {compPlaying ? (
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                  ) : (
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>

                <div className="flex flex-col flex-1 gap-1 min-w-0">
                  <div className="flex justify-between text-xs text-stone-500 px-1 select-none">
                    <div>
                      From:{" "}
                      <span className="text-stone-600 font-mono">
                        {months[compStartIdx]}
                      </span>
                    </div>
                    <div>
                      To:{" "}
                      <span className="text-stone-600 font-mono">
                        {months[compEndIdx]}
                      </span>
                    </div>
                  </div>

                  <div className="relative w-full h-5 flex items-center min-w-0">
                    <div className="absolute left-0 right-0 h-1.5 bg-stone-200 rounded-lg z-0" />
                    <div
                      className="absolute h-1.5 bg-indigo-600 rounded-lg z-10"
                      style={{
                        left: `${compMinPercent}%`,
                        right: `${100 - compMaxPercent}%`,
                      }}
                    />
                    <input
                      type="range"
                      min={0}
                      max={maxIdx}
                      value={compStartIdx}
                      disabled={compSelYear !== "all"}
                      onChange={(e) =>
                        setCompStartIdx(Math.min(+e.target.value, compEndIdx))
                      }
                      className="absolute w-full h-1.5 appearance-none bg-transparent pointer-events-none cursor-pointer z-20 min-w-0
                      [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-600 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow"
                    />
                    <input
                      type="range"
                      min={0}
                      max={maxIdx}
                      value={compEndIdx}
                      disabled={compSelYear !== "all"}
                      onChange={(e) =>
                        setCompEndIdx(Math.max(+e.target.value, compStartIdx))
                      }
                      className="absolute w-full h-1.5 appearance-none bg-transparent pointer-events-none cursor-pointer z-20 min-w-0
                      [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-600 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
