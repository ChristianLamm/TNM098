import * as d3 from 'd3';

export async function loadAndParseData(url) {
    const rawData = await d3.tsv(url);
    
    // Parse numeric fields and clean up data
    const data = rawData.map(d => ({
        timestamp: +d['RecordingTimestamp'],
        fixationIndex: +d['FixationIndex'],
        duration: +d['GazeEventDuration(mS)'],
        x: +d['GazePointX(px)'],
        y: +d['GazePointY(px)'],
        // We will assign AOI id later when drawing regions
        aoi: null 
    })).filter(d => !isNaN(d.x) && !isNaN(d.y) && !isNaN(d.timestamp));

    // Normalize timestamps to start from 0 if needed, or keep to relative milliseconds
    const minTime = d3.min(data, d => d.timestamp);
    data.forEach(d => {
        d.relativeTime = d.timestamp - minTime; // ms from start
    });

    return data;
}

export function classifyPoints(data, regions) {
    // A region could be an object {id: 1, x, y, width, height, color}
    data.forEach(d => {
        let assigned = null;
        for (let r of regions) {
            if (d.x >= r.x && d.x <= r.x + r.width &&
                d.y >= r.y && d.y <= r.y + r.height) {
                assigned = r.id;
                break; // Assign to first matching region
            }
        }
        d.aoi = assigned;
    });
    return data;
}

export function generateTransitions(data, timeWindowStart = 0, timeWindowEnd = Infinity) {
    let transitions = [];
    const validData = data.filter(d => d.relativeTime >= timeWindowStart && d.relativeTime <= timeWindowEnd && d.aoi !== null);
    
    if (validData.length === 0) return transitions;

    for (let i = 1; i < validData.length; i++) {
        let source = validData[i-1].aoi;
        let target = validData[i].aoi;
        if (source !== target) {
            transitions.push({ source, target });
        }
    }
    
    return transitions;
}
