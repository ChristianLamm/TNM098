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

// Scales never change — domain is always 0-200, canvas 800×800
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

export default function MapDashboard() {
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<d3.Selection<
    SVGGElement,
    unknown,
    null,
    undefined
  > | null>(null);
  const colorRef = useRef<d3.ScaleOrdinal<string, string> | null>(null);

  const [data, setData] = useState<BirdData[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [species, setSpecies] = useState<string[]>([]);
  const [startIdx, setStartIdx] = useState(0);
  const [endIdx, setEndIdx] = useState(0);
  const [selSpecies, setSelSpecies] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"scatter" | "heatmap">("scatter");
  const [typeFilter, setTypeFilter] = useState<
    "all" | "call" | "song" | "both"
  >("all");
  const [playing, setPlaying] = useState(false);
  const [tooltip, setTooltip] = useState<Tooltip>(null);

  // för sliders
  const maxIdx = months.length - 1;
  const minPercent = maxIdx > 0 ? (startIdx / maxIdx) * 100 : 0;
  const maxPercent = maxIdx > 0 ? (endIdx / maxIdx) * 100 : 0;

  // O(1) month index lookup
  const monthMap = useMemo(() => {
    const m = new Map<string, number>();
    months.forEach((v, i) => m.set(v, i));
    return m;
  }, [months]);

  // Color scale derived for React JSX (sidebar color dots)
  const colorScale = useMemo(
    () => d3.scaleOrdinal<string>(d3.schemeCategory10).domain(species),
    [species],
  );

  // Visible sighting count for display
  const sightingCount = useMemo(
    () =>
      data.filter((d) => {
        const i = monthMap.get(d.YearMonth) ?? -1;
        return (
          i >= startIdx &&
          i <= endIdx &&
          selSpecies.has(d.English_name) &&
          (typeFilter === "all" || d.Type === typeFilter)
        );
      }).length,
    [data, monthMap, startIdx, endIdx, selSpecies, typeFilter],
  );

  // Load data
  useEffect(() => {
    fetch("/map_data.json")
      .then((r) => r.json())
      .then((json: BirdData[]) => {
        setData(json);
        const ms = Array.from(new Set(json.map((d) => d.YearMonth))).sort();
        const sp = Array.from(new Set(json.map((d) => d.English_name))).sort();
        setMonths(ms);
        setSpecies(sp);
        setSelSpecies(new Set(sp));
        setStartIdx(0);
        setEndIdx(ms.length - 1);
      });
  }, []);

  // Play animation — advances end index one step at a time
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

  // ONE-TIME SVG SETUP — only reruns if the dataset itself changes (never in practice)
  useEffect(() => {
    if (!data.length || !species.length || !svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg
      .append("defs")
      .append("filter")
      .attr("id", "blur")
      .append("feGaussianBlur")
      .attr("stdDeviation", 4);
    colorRef.current = d3
      .scaleOrdinal<string>(d3.schemeCategory10)
      .domain(species);
    gRef.current = svg.append("g");
  }, [data, species]);

  // DATA JOIN — updates only the dot layer, no full SVG rebuild
  useEffect(() => {
    const g = gRef.current;
    const color = colorRef.current;
    if (!g || !color || !months.length || !data.length) return;

    const filtered = data.filter((d) => {
      const i = monthMap.get(d.YearMonth) ?? -1;
      return (
        i >= startIdx &&
        i <= endIdx &&
        selSpecies.has(d.English_name) &&
        (typeFilter === "all" || d.Type === typeFilter)
      );
    });

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
  }, [
    data,
    months,
    monthMap,
    startIdx,
    endIdx,
    selSpecies,
    viewMode,
    typeFilter,
  ]);

  if (!months.length)
    return (
      <div className="p-8 text-center text-stone-500 text-xl">
        Loading Spatiotemporal Data...
      </div>
    );

  return (
    <>
      {/* Hover tooltip — fixed to viewport, above everything */}
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

      <div className="flex flex-col md:flex-row gap-6 items-start max-w-[1100px] mx-auto">
        {/* Sidebar Controls */}
        <div className="w-full md:w-72 flex flex-col gap-5 bg-white p-5 rounded-xl shadow-lg border border-stone-200 shrink-0">
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
            <span className="text-sm font-semibold text-stone-700 block mb-2">
              Vocalization Type
            </span>
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
              <span className="text-stone-400 text-sm">
                {sightingCount.toLocaleString()} sightings
              </span>
              <span className="text-stone-700 font-mono font-bold bg-stone-100 px-3 py-1 rounded-md border border-stone-200 text-sm whitespace-nowrap">
                {months[startIdx]} <span className="text-stone-400">→</span>{" "}
                {months[endIdx]}
              </span>
            </div>
          </div>

          <div className="relative w-full aspect-square border-2 border-stone-300 rounded-lg overflow-hidden bg-stone-100 shadow-inner max-h-[600px]">
            <img
              src="/map_background.bmp"
              alt="Lekagul Roadways Map"
              className="absolute inset-0 w-full h-full object-cover opacity-80"
              style={{ imageRendering: "pixelated" }}
            />
            <svg
              ref={svgRef}
              viewBox="0 0 800 800"
              className="absolute inset-0 w-full h-full z-10"
            />
          </div>

          {/* Timeline controls */}
          <div className="flex flex-col gap-2 bg-stone-50 p-4 rounded-lg border border-stone-200">
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  // If at the end, reset before playing
                  if (!playing && endIdx >= months.length - 1)
                    setEndIdx(startIdx);
                  setPlaying((p) => !p);
                }}
                className="w-9 h-9 flex items-center justify-center bg-indigo-600 hover:bg-indigo-500 text-white rounded-full transition-colors shrink-0 shadow-sm"
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

              {/* Sliders */}
              <div className="flex flex-col flex-1 gap-1 min-w-0">
                {/* Topprad som visar nuvarande intervall */}
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

                {/* Själva slider-ytan där båda reglagen delar spår */}
                <div className="relative w-full h-5 flex items-center min-w-0">
                  {/* 1. Det gråa bakgrundsspåret */}
                  <div className="absolute left-0 right-0 h-1.5 bg-stone-200 rounded-lg z-0" />

                  {/* 2. Det färgade intervallet mellan startIdx och endIdx */}
                  <div
                    className="absolute h-1.5 bg-indigo-600 rounded-lg z-10"
                    style={{
                      left: `${minPercent}%`,
                      right: `${100 - maxPercent}%`,
                    }}
                  />

                  {/* 3. Från-slidern (Genomskinlig, men med synligt lila handtag) */}
                  <input
                    type="range"
                    min={0}
                    max={maxIdx}
                    value={startIdx}
                    onChange={(e) =>
                      setStartIdx(Math.min(+e.target.value, endIdx))
                    }
                    className="absolute w-full h-1.5 appearance-none bg-transparent pointer-events-none cursor-pointer z-20 min-w-0
            [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-600 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow
            [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-indigo-600 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow"
                  />

                  {/* 4. Till-slidern (Genomskinlig, men med synligt lila handtag) */}
                  <input
                    type="range"
                    min={0}
                    max={maxIdx}
                    value={endIdx}
                    onChange={(e) =>
                      setEndIdx(Math.max(+e.target.value, startIdx))
                    }
                    className="absolute w-full h-1.5 appearance-none bg-transparent pointer-events-none cursor-pointer z-20 min-w-0
            [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-600 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow
            [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-indigo-600 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
