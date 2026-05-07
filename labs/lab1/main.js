import * as d3 from 'd3';
import { loadAndParseData, classifyPoints, generateTransitions } from './data-parser.js';
import { SpatialView } from './spatial-view.js';
import { TemporalView } from './temporal-view.js';
import { FlowView } from './flow-view.js';

let rawData = [];
let regions = [];
let maxTime = 0;
let maxTimeMs = 0;

// Filter States
let timeWindowStart = 0;
let timeWindowEnd = Infinity;

// UI Elements
const timeScrubSlider = document.getElementById('time-scrub');
const timeScrubVal = document.getElementById('time-scrub-val');
const timeStartInput = document.getElementById('time-start');
const timeEndInput = document.getElementById('time-end');
const toggleHeatmapBtn = document.getElementById('toggle-heatmap');
const clearAoiBtn = document.getElementById('clear-aoi');

const colorScale = d3.scaleOrdinal(d3.schemeCategory10);

let spatialView;
let temporalView;
let flowView;

async function bootstrap() {
    rawData = await loadAndParseData('./EyeTrack-raw.tsv');
    if(rawData.length === 0) return;
    
    maxTimeMs = d3.max(rawData, d => d.relativeTime) || 0;
    maxTime = Math.ceil(maxTimeMs / 1000);
    timeWindowEnd = maxTimeMs;
    
    // Set UI defaults
    timeEndInput.max = maxTime;
    timeStartInput.max = maxTime;
    timeEndInput.value = `${maxTime}`;
    timeScrubSlider.max = maxTime;
    timeScrubSlider.value = `${maxTime}`;
    timeScrubVal.textContent = `${maxTime}s`;

    spatialView = new SpatialView('#spatial-container', 1920, 1080, handleRegionsChanged);
    temporalView = new TemporalView('#timeline-container', colorScale);
    flowView = new FlowView('#flow-container', colorScale);

    syncWindowControls();

    // Filter Listeners
    timeScrubSlider.addEventListener('input', (e) => {
        const endSec = +e.target.value || 0;
        timeScrubVal.textContent = `${endSec}s`;
        setWindow(0, endSec * 1000);
    });

    timeStartInput.addEventListener('input', (e) => {
        const startMs = (+e.target.value || 0) * 1000;
        setWindow(startMs, timeWindowEnd);
    });

    timeEndInput.addEventListener('input', (e) => {
        const endMs = (+e.target.value || 0) * 1000;
        setWindow(timeWindowStart, endMs);
    });

    toggleHeatmapBtn.addEventListener('click', () => {
        spatialView.toggleHeatmap();
    });

    clearAoiBtn.addEventListener('click', () => {
        spatialView.clearRegions();
    });

    updateViews();
}

function handleRegionsChanged(newRegions) {
    regions = newRegions;
    rawData = classifyPoints(rawData, regions);
    updateViews();
}

function setWindow(startMs, endMs) {
    const maxMs = maxTimeMs;
    let boundedStart = Math.max(0, Math.min(startMs, maxMs));
    let boundedEnd = Math.max(0, Math.min(endMs, maxMs));

    if (boundedEnd < boundedStart) {
        [boundedStart, boundedEnd] = [boundedEnd, boundedStart];
    }

    if (boundedStart === boundedEnd && maxMs > 1000) {
        if (boundedEnd < maxMs) boundedEnd += 1000;
        else boundedStart = Math.max(0, boundedStart - 1000);
    }

    timeWindowStart = boundedStart;
    timeWindowEnd = boundedEnd;
    syncWindowControls();
    updateViews();
}

function syncWindowControls() {
    const startSec = Math.round(timeWindowStart / 1000);
    const endSec = Math.round(timeWindowEnd / 1000);
    timeStartInput.value = `${startSec}`;
    timeEndInput.value = `${endSec}`;
    timeScrubSlider.value = `${endSec}`;
    timeScrubVal.textContent = `${endSec}s`;
}

function updateViews() {
    let filteredData = rawData;
    
    // 2. Spatial View: Renders points ONLY within the selected time window
    spatialView.render(filteredData, timeWindowStart, timeWindowEnd);
    
    // 3. Temporal View: Shows frequency map of ALL fixations filtered by duration, 
    // and we can pass the window to visually highlight it if we implement that.
    temporalView.render(filteredData, {
        activeTimeStart: timeWindowStart,
        activeTimeEnd: timeWindowEnd,
        binSizeMs: 10000,
        valueMode: 'count'
    });

    // 4. Flow View: Calculates flows strictly inside this time bounds
    const transitions = generateTransitions(filteredData, timeWindowStart, timeWindowEnd);
    flowView.render(transitions, {
        minCount: 1,
        normalizeBySource: false,
        showLabels: false
    });
}

bootstrap();
