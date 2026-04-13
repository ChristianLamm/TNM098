import * as d3 from 'd3';
import { contourDensity } from 'd3-contour';

export class SpatialView {
    constructor(containerId, width, height, onRegionsChange) {
        this.container = d3.select(containerId);
        this.width = width;
        this.height = height;
        this.onRegionsChange = onRegionsChange;
        
        this.regions = [];
        this.showHeatmap = false;
        
        this.colorScale = d3.scaleOrdinal(d3.schemeCategory10);

        this.init();
    }

    init() {
        // Create standard aspect ratio SVG for screen size
        this.svg = this.container.append('svg')
            .attr('viewBox', `0 0 ${this.width} ${this.height}`)
            .attr('preserveAspectRatio', 'xMidYMid meet')
            .style('width', '100%')
            .style('height', '100%')
            .style('background', '#1e293b') // Dark background representing screen off
            .style('border-radius', '8px');

        this.heatmapGroup = this.svg.append('g').attr('class', 'heatmap-layer').style('display', 'none');
        this.scatterGroup = this.svg.append('g').attr('class', 'scatter-layer');
        this.regionsGroup = this.svg.append('g').attr('class', 'regions-layer');
        
        // Setup brush to act as AOI drawing tool
        this.brush = d3.brush()
            .extent([[0, 0], [this.width, this.height]])
            .on("end", this.brushEnded.bind(this));
            
        this.brushGroup = this.svg.append('g')
            .attr('class', 'brush')
            .call(this.brush);
    }

    render(data, activeTimeStart = 0, activeTimeEnd = Infinity) {
        this.currentData = data;
        const activeData = data.filter(d => d.relativeTime >= activeTimeStart && d.relativeTime <= activeTimeEnd);

        // Scales
        const rScale = d3.scaleSqrt()
            .domain([0, d3.max(data, d => d.duration) || 1000])
            .range([2, 20]);

        // Draw scatter
        const circles = this.scatterGroup.selectAll('circle')
            .data(activeData, d => d.fixationIndex);

        circles.enter()
            .append('circle')
            .attr('cx', d => d.x)
            .attr('cy', d => d.y)
            .attr('r', 0)
            .attr('fill', d => d.aoi ? this.colorScale(d.aoi) : 'rgba(255,255,255,0.4)')
            .attr('opacity', 0.5)
            .merge(circles)
            .transition().duration(200)
            .attr('r', d => rScale(d.duration))
            .attr('fill', d => d.aoi ? this.colorScale(d.aoi) : 'rgba(255,255,255,0.4)');

        circles.exit()
            .transition().duration(200)
            .attr('r', 0)
            .remove();

        // Heatmap
        this.renderHeatmap(activeData);
        
        // Redraw regions 
        this.renderRegions();
    }

    renderHeatmap(data) {
        this.heatmapGroup.selectAll('*').remove();

        if (data.length === 0) return;

        const densityData = contourDensity()
            .x(d => d.x)
            .y(d => d.y)
            .size([this.width, this.height])
            .bandwidth(30)
            .thresholds(20)
            (data);

        // Color scale for density
        const color = d3.scaleSequential(d3.interpolateInferno)
            .domain([0, d3.max(densityData, d => d.value)]);

        this.heatmapGroup.selectAll('path')
            .data(densityData)
            .enter().append('path')
            .attr('d', d3.geoPath())
            .attr('fill', d => color(d.value))
            .attr('opacity', 0.6)
            .attr('stroke', 'none');
    }

    toggleHeatmap() {
        this.showHeatmap = !this.showHeatmap;
        this.heatmapGroup.style('display', this.showHeatmap ? 'block' : 'none');
        this.scatterGroup.style('opacity', this.showHeatmap ? 0.3 : 1);
    }

    brushEnded(event) {
        if (!event.selection) return;

        const [[x0, y0], [x1, y1]] = event.selection;
        
        const newRegion = {
            id: `Region ${this.regions.length + 1}`,
            x: x0,
            y: y0,
            width: x1 - x0,
            height: y1 - y0
        };

        this.regions.push(newRegion);
        
        // Clear brush selection immediately
        this.brushGroup.call(this.brush.move, null);
        
        this.renderRegions();
        
        // Notify parent to reclassify and redraw
        if (this.onRegionsChange) {
            this.onRegionsChange(this.regions);
        }
    }

    renderRegions() {
        const rects = this.regionsGroup.selectAll('rect')
            .data(this.regions, d => d.id);

        rects.enter()
            .append('rect')
            .attr('x', d => d.x)
            .attr('y', d => d.y)
            .attr('width', d => d.width)
            .attr('height', d => d.height)
            .attr('fill', d => this.colorScale(d.id))
            .attr('fill-opacity', 0.2)
            .attr('stroke', d => this.colorScale(d.id))
            .attr('stroke-width', 3);

        const labels = this.regionsGroup.selectAll('text')
            .data(this.regions, d => d.id);

        labels.enter()
            .append('text')
            .attr('x', d => d.x + 5)
            .attr('y', d => d.y + 20)
            .text(d => d.id)
            .attr('fill', 'white')
            .style('font-weight', 'bold')
            .style('text-shadow', '1px 1px 2px black');

        rects.exit().remove();
        labels.exit().remove();
        
        // Ensure brush is always on top
        this.brushGroup.raise();
    }

    clearRegions() {
        this.regions = [];
        this.renderRegions();
        if (this.onRegionsChange) {
            this.onRegionsChange(this.regions);
        }
    }
}
