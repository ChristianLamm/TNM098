import * as d3 from 'd3';

export class TemporalView {
    constructor(containerId, colorScale) {
        this.container = d3.select(containerId);
        this.colorScale = colorScale;

        // Dimensions
        const rect = this.container.node().getBoundingClientRect();
        this.margin = { top: 10, right: 20, bottom: 30, left: 40 };
        this.width = rect.width;
        this.height = 150;

        this.init();
    }

    init() {
        this.svg = this.container.append('svg')
            .attr('width', '100%')
            .attr('height', '100%')
            .attr('viewBox', `0 0 ${this.width} ${this.height}`)
            .attr('preserveAspectRatio', 'none'); // Allow stretching to fit bounding box

        this.chartArea = this.svg.append('g')
            .attr('transform', `translate(${this.margin.left}, ${this.margin.top})`);

        this.xAxisGroup = this.chartArea.append('g')
            .attr('transform', `translate(0, ${this.height - this.margin.top - this.margin.bottom})`)
            .attr('class', 'axis');

        this.yAxisGroup = this.chartArea.append('g')
            .attr('class', 'axis');

        // Overlay a line or rect to show current active time if playing, which we won't strictly need here unless we want to show playhead
    }

    render(data, options = {}) {
        if (!data || data.length === 0) return;

        const {
            activeTimeStart = 0,
            activeTimeEnd = Infinity,
            binSizeMs = 10000,
            valueMode = 'count'
        } = options;

        const maxTime = d3.max(data, d => d.relativeTime) || 0;
        const safeBinSize = Math.max(1000, binSizeMs);
        const numBins = Math.max(1, Math.ceil((maxTime + 1) / safeBinSize));

        const binnedData = Array.from({ length: numBins }, (_, i) => ({
            time: i * safeBinSize
        }));

        const assignedFixations = data.filter(d => d.aoi !== null);
        assignedFixations.forEach(d => {
            const binIdx = Math.floor(d.relativeTime / safeBinSize);
            const boundedIdx = Math.max(0, Math.min(numBins - 1, binIdx));
            const regionKey = d.aoi;
            const addValue = valueMode === 'duration' ? d.duration : 1;
            binnedData[boundedIdx][regionKey] = (binnedData[boundedIdx][regionKey] || 0) + addValue;
        });

        const allRegions = Array.from(new Set(assignedFixations.map(d => d.aoi)));
        binnedData.forEach(bin => {
            allRegions.forEach(region => {
                if (!bin[region]) bin[region] = 0;
            });
        });

        const series = d3.stack()
            .keys(allRegions)
            (binnedData);

        const w = this.width - this.margin.left - this.margin.right;
        const h = this.height - this.margin.top - this.margin.bottom;

        const xScale = d3.scaleLinear()
            .domain([0, Math.max(maxTime, safeBinSize)])
            .range([0, w]);

        const yScale = d3.scaleLinear()
            .domain([0, d3.max(series, layer => d3.max(layer, d => d[1])) || 1])
            .range([h, 0]);

        const formatTime = ms => `${Math.round(ms / 1000)}s`;
        this.xAxisGroup.call(d3.axisBottom(xScale).ticks(8).tickFormat(formatTime));
        this.yAxisGroup.call(d3.axisLeft(yScale).ticks(5));

        this.chartArea.selectAll('.layer').remove();
        const layers = this.chartArea.selectAll('.layer')
            .data(series)
            .enter().append('g')
            .attr('class', 'layer')
            .style('fill', d => this.colorScale(d.key));

        const barWidth = Math.max(1, (w / numBins) - 1);
        layers.selectAll('rect')
            .data(d => d)
            .enter().append('rect')
            .attr('x', d => xScale(d.data.time))
            .attr('width', barWidth)
            .attr('y', h)
            .attr('height', 0)
            .transition().duration(350)
            .attr('y', d => yScale(d[1]))
            .attr('height', d => yScale(d[0]) - yScale(d[1]));

        this.chartArea.selectAll('.window-highlight').remove();
        const boundedEnd = Math.min(activeTimeEnd, maxTime);
        if (boundedEnd > activeTimeStart) {
            this.chartArea.append('rect')
                .attr('class', 'window-highlight')
                .attr('x', xScale(activeTimeStart))
                .attr('width', Math.max(1, xScale(boundedEnd) - xScale(activeTimeStart)))
                .attr('y', 0)
                .attr('height', h)
                .attr('fill', 'rgba(255,255,255,0.1)')
                .attr('stroke', 'rgba(255,255,255,0.4)')
                .attr('stroke-width', 1)
                .attr('pointer-events', 'none');
        }
    }
}
