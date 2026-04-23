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
let minDuration = 0;
let timeWindowStart = 0;
let timeWindowEnd = Infinity;
let temporalBinSizeMs = 10000;
let temporalMode = 'count';
let flowMinCount = 1;
let flowNormalize = false;
let flowShowLabels = true;
let playStepMs = 5000;
let playbackTimer = null;

// UI Elements
const durationSlider = document.getElementById('duration-filter');
const durationVal = document.getElementById('duration-val');
const timeStartInput = document.getElementById('time-start');
const timeEndInput = document.getElementById('time-end');
const timeStartSlider = document.getElementById('time-start-slider');
const timeEndSlider = document.getElementById('time-end-slider');
const playStepSlider = document.getElementById('play-step');
const playStepVal = document.getElementById('play-step-val');
const playWindowBtn = document.getElementById('play-window');
const resetWindowBtn = document.getElementById('reset-window');
const windowSizeVal = document.getElementById('window-size-val');
const binSizeSlider = document.getElementById('bin-size');
const binSizeVal = document.getElementById('bin-size-val');
const temporalModeSelect = document.getElementById('temporal-mode');
const flowMinCountSlider = document.getElementById('flow-min-count');
const flowMinCountVal = document.getElementById('flow-min-count-val');
const flowNormalizeCheckbox = document.getElementById('flow-normalize');
const flowLabelsCheckbox = document.getElementById('flow-labels');
const toggleHeatmapBtn = document.getElementById('toggle-heatmap');
const clearAoiBtn = document.getElementById('clear-aoi');
const flowStatsContainer = document.getElementById('flow-stats');

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
    timeStartSlider.max = maxTime;
    timeEndSlider.max = maxTime;
    timeEndSlider.value = maxTime;

    const maxDuration = Math.ceil(d3.max(rawData, d => d.duration) || 1000);
    durationSlider.max = maxDuration;
    durationVal.textContent = `${minDuration}ms`;
    binSizeVal.textContent = `${Math.round(temporalBinSizeMs / 1000)}s`;
    flowMinCountVal.textContent = `${flowMinCount}`;
    playStepVal.textContent = `${Math.round(playStepMs / 1000)}s`;

    spatialView = new SpatialView('#spatial-container', 1920, 1080, handleRegionsChanged);
    temporalView = new TemporalView('#timeline-container', colorScale);
    flowView = new FlowView('#flow-container', colorScale);

    syncWindowControls();

    // Filter Listeners
    durationSlider.addEventListener('input', (e) => {
        minDuration = +e.target.value;
        durationVal.textContent = `${minDuration}ms`;
        updateViews();
    });

    timeStartInput.addEventListener('input', (e) => {
        stopPlayback();
        const startMs = (+e.target.value || 0) * 1000;
        setWindow(startMs, timeWindowEnd);
    });

    timeEndInput.addEventListener('input', (e) => {
        stopPlayback();
        const endMs = (+e.target.value || 0) * 1000;
        setWindow(timeWindowStart, endMs);
    });

    timeStartSlider.addEventListener('input', (e) => {
        stopPlayback();
        const startMs = (+e.target.value || 0) * 1000;
        setWindow(startMs, Math.max(startMs, timeWindowEnd));
    });

    timeEndSlider.addEventListener('input', (e) => {
        stopPlayback();
        const endMs = (+e.target.value || 0) * 1000;
        setWindow(Math.min(timeWindowStart, endMs), endMs);
    });

    playStepSlider.addEventListener('input', (e) => {
        playStepMs = (+e.target.value || 1) * 1000;
        playStepVal.textContent = `${Math.round(playStepMs / 1000)}s`;
    });

    playWindowBtn.addEventListener('click', () => {
        if (playbackTimer) {
            stopPlayback();
        } else {
            startPlayback();
        }
    });

    resetWindowBtn.addEventListener('click', () => {
        stopPlayback();
        setWindow(0, maxTimeMs);
    });

    binSizeSlider.addEventListener('input', (e) => {
        temporalBinSizeMs = (+e.target.value || 10) * 1000;
        binSizeVal.textContent = `${Math.round(temporalBinSizeMs / 1000)}s`;
        updateViews();
    });

    temporalModeSelect.addEventListener('change', (e) => {
        temporalMode = e.target.value;
        updateViews();
    });

    flowMinCountSlider.addEventListener('input', (e) => {
        flowMinCount = +e.target.value || 1;
        flowMinCountVal.textContent = `${flowMinCount}`;
        updateViews();
    });

    flowNormalizeCheckbox.addEventListener('change', (e) => {
        flowNormalize = e.target.checked;
        updateViews();
    });

    flowLabelsCheckbox.addEventListener('change', (e) => {
        flowShowLabels = e.target.checked;
        updateViews();
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
    timeStartSlider.value = `${startSec}`;
    timeEndSlider.value = `${endSec}`;
    windowSizeVal.textContent = `${Math.max(0, endSec - startSec)}s`;
}

function startPlayback() {
    if (playbackTimer) return;
    playWindowBtn.textContent = 'Pause Window';
    playbackTimer = setInterval(() => {
        const windowSize = Math.max(1000, timeWindowEnd - timeWindowStart);
        let nextStart = timeWindowStart + playStepMs;
        let nextEnd = nextStart + windowSize;

        if (nextEnd > maxTimeMs) {
            nextEnd = maxTimeMs;
            nextStart = Math.max(0, nextEnd - windowSize);
            stopPlayback();
        }

        setWindow(nextStart, nextEnd);
    }, 400);
}

function stopPlayback() {
    if (!playbackTimer) return;
    clearInterval(playbackTimer);
    playbackTimer = null;
    playWindowBtn.textContent = 'Play Window';
}

function renderFlowSummary(summary) {
    if (!flowStatsContainer) return;
    if (!summary || summary.totalTransitions === 0) {
        flowStatsContainer.innerHTML = 'No region transitions in the selected window. Draw AOIs and/or widen the time window.';
        return;
    }

    const topLinks = summary.topLinks.map(link => {
        const pct = Math.round((link.normalizedValue || 0) * 100);
        return `${link.source} -> ${link.target}: <strong>${link.value}</strong>${flowNormalize ? ` (${pct}%)` : ''}`;
    }).join('<br>');

    flowStatsContainer.innerHTML = `
        <strong>Transitions (in active window):</strong> ${summary.totalTransitions}<br>
        <strong>Visible after threshold:</strong> ${summary.shownTransitions} across ${summary.linkCount} directed links and ${summary.nodeCount} regions.<br>
        <strong>Top links:</strong><br>${topLinks || 'No links pass current threshold.'}
    `;
}

function updateViews() {
    // 1. Filter the entire dataset by duration bounds (Global Noise filter)
    let filteredData = rawData.filter(d => d.duration >= minDuration);
    
    // 2. Spatial View: Renders points ONLY within the selected time window
    spatialView.render(filteredData, timeWindowStart, timeWindowEnd);
    
    // 3. Temporal View: Shows frequency map of ALL fixations filtered by duration, 
    // and we can pass the window to visually highlight it if we implement that.
    temporalView.render(filteredData, {
        activeTimeStart: timeWindowStart,
        activeTimeEnd: timeWindowEnd,
        binSizeMs: temporalBinSizeMs,
        valueMode: temporalMode
    });

    // 4. Flow View: Calculates flows strictly inside this time bounds
    const transitions = generateTransitions(filteredData, timeWindowStart, timeWindowEnd);
    const summary = flowView.render(transitions, {
        minCount: flowMinCount,
        normalizeBySource: flowNormalize,
        showLabels: flowShowLabels
    });
    renderFlowSummary(summary);
}

bootstrap();
