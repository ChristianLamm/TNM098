import * as d3 from 'd3';

export class FlowView {
    constructor(containerId, colorScale) {
        this.container = d3.select(containerId);
        this.colorScale = colorScale;
        
        // Dimensions
        const rect = this.container.node().getBoundingClientRect();
        this.width = rect.width || 400;
        this.height = rect.height || 400;
        
        this.init();
    }

    init() {
        this.svg = this.container.append('svg')
            .attr('viewBox', `0 0 ${this.width} ${this.height}`)
            .attr('preserveAspectRatio', 'xMidYMid meet')
            .style('width', '100%')
            .style('height', '100%');
            
        this.svg.append('defs').append('marker')
            .attr('id', 'arrowend')
            .attr('viewBox', '0 -5 10 10')
            .attr('refX', 20)
            .attr('refY', 0)
            .attr('markerUnits', 'userSpaceOnUse')
            .attr('markerWidth', 8)
            .attr('markerHeight', 8)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M0,-5L10,0L0,5')
            .attr('fill', '#94a3b8');

        this.linksGroup = this.svg.append('g').attr('class', 'links');
        this.linkLabelsGroup = this.svg.append('g').attr('class', 'link-labels');
        this.nodesGroup = this.svg.append('g').attr('class', 'nodes');
        
        this.simulation = d3.forceSimulation()
            .force("link", d3.forceLink().id(d => d.id).distance(100))
            .force("charge", d3.forceManyBody().strength(-300))
            .force("center", d3.forceCenter(this.width / 2, this.height / 2));
    }

    render(transitions, options = {}) {
        const {
            minCount = 1,
            normalizeBySource = false,
            showLabels = true
        } = options;

        if (!transitions || transitions.length === 0) {
            this.linksGroup.selectAll('*').remove();
            this.linkLabelsGroup.selectAll('*').remove();
            this.nodesGroup.selectAll('*').remove();
            return {
                totalTransitions: 0,
                shownTransitions: 0,
                nodeCount: 0,
                linkCount: 0,
                topLinks: []
            };
        }

        // Aggregate transitions A -> B
        const flowCounts = {};
        const nodesSet = new Set();
        
        transitions.forEach(t => {
            const key = `${t.source}|${t.target}`;
            flowCounts[key] = (flowCounts[key] || 0) + 1;
            nodesSet.add(t.source);
            nodesSet.add(t.target);
        });

        const linksData = Object.keys(flowCounts).map(k => {
            const parts = k.split('|');
            return {
                source: parts[0],
                target: parts[1],
                value: flowCounts[k]
            };
        });

        const sourceTotals = {};
        linksData.forEach(link => {
            sourceTotals[link.source] = (sourceTotals[link.source] || 0) + link.value;
        });

        const filteredLinks = linksData
            .filter(link => link.value >= minCount)
            .map(link => {
                const normalizedValue = link.value / (sourceTotals[link.source] || 1);
                return {
                    ...link,
                    normalizedValue,
                    widthValue: normalizeBySource ? normalizedValue : link.value,
                    label: normalizeBySource
                        ? `${link.value} (${Math.round(normalizedValue * 100)}%)`
                        : `${link.value}`
                };
            });

        if (filteredLinks.length === 0) {
            this.linksGroup.selectAll('*').remove();
            this.linkLabelsGroup.selectAll('*').remove();
            this.nodesGroup.selectAll('*').remove();
            return {
                totalTransitions: transitions.length,
                shownTransitions: 0,
                nodeCount: 0,
                linkCount: 0,
                topLinks: linksData
                    .sort((a, b) => b.value - a.value)
                    .slice(0, 5)
                    .map(d => ({
                        source: d.source,
                        target: d.target,
                        value: d.value,
                        normalizedValue: d.value / (sourceTotals[d.source] || 1)
                    }))
            };
        }

        const visibleNodeIds = new Set();
        filteredLinks.forEach(link => {
            visibleNodeIds.add(link.source);
            visibleNodeIds.add(link.target);
        });

        const nodesData = Array.from(visibleNodeIds).map(id => ({ id }));

        const reverseLookup = new Set(filteredLinks.map(d => `${d.target}->${d.source}`));

        // Scales
        const minWidthValue = d3.min(filteredLinks, d => d.widthValue) || 0;
        const maxWidthValue = d3.max(filteredLinks, d => d.widthValue) || 1;
        const linkWidthScale = d3.scaleLinear()
            .domain([minWidthValue, maxWidthValue])
            .range([1.5, 7]);

        // Links
        const link = this.linksGroup.selectAll("path")
            .data(filteredLinks, d => `${// @ts-ignore
                d.source.id || d.source}->${// @ts-ignore
                d.target.id || d.target}`);

        link.enter().append("path")
            .attr("stroke", "#94a3b8")
            .attr("stroke-opacity", 0.6)
            .attr("fill", "none")
            .attr("marker-end", "url(#arrowend)")
            .merge(link)
            .attr("stroke-width", d => linkWidthScale(d.widthValue));

        link.exit().remove();

        const labels = this.linkLabelsGroup.selectAll('text')
            .data(showLabels ? filteredLinks : [], d => `${// @ts-ignore
                d.source.id || d.source}->${// @ts-ignore
                d.target.id || d.target}`);

        labels.enter()
            .append('text')
            .style('font-size', '11px')
            .style('font-weight', '600')
            .style('fill', '#e2e8f0')
            .style('paint-order', 'stroke')
            .style('stroke', 'rgba(15, 23, 42, 0.95)')
            .style('stroke-width', '3px')
            .merge(labels)
            .text(d => d.label)
            .attr('text-anchor', 'middle');

        labels.exit().remove();

        // Nodes
        const node = this.nodesGroup.selectAll("g")
            .data(nodesData, d => d.id);

        const nodeEnter = node.enter().append("g");
        
        nodeEnter.append("circle")
            .attr("r", 15)
            .attr("fill", d => this.colorScale(d.id))
            .attr("stroke", "white")
            .attr("stroke-width", 2);

        nodeEnter.append("text")
            .text(d => d.id)
            .attr("x", 20)
            .attr("y", 5)
            .style("fill", "white")
            .style("font-size", "12px")
            .style("font-family", "Arial");

        const allNodes = nodeEnter.merge(node);
        node.exit().remove();

        // Restart simulation
        this.simulation
            .nodes(nodesData)
            .on("tick", () => {
                this.linksGroup.selectAll("path").attr("d", d => {
                    // @ts-ignore
                    const sx = d.source.x;
                    // @ts-ignore
                    const sy = d.source.y;
                    // @ts-ignore
                    const tx = d.target.x;
                    // @ts-ignore
                    const ty = d.target.y;

                    // @ts-ignore
                    const sourceId = d.source.id;
                    // @ts-ignore
                    const targetId = d.target.id;

                    const hasReverse = reverseLookup.has(`${sourceId}->${targetId}`) && reverseLookup.has(`${targetId}->${sourceId}`);
                    if (!hasReverse) {
                        return `M${sx},${sy}L${tx},${ty}`;
                    }

                    const dx = tx - sx;
                    const dy = ty - sy;
                    const length = Math.sqrt(dx * dx + dy * dy) || 1;
                    const nx = -dy / length;
                    const ny = dx / length;
                    const direction = sourceId < targetId ? 1 : -1;
                    const cx = (sx + tx) / 2 + nx * length * 0.18 * direction;
                    const cy = (sy + ty) / 2 + ny * length * 0.18 * direction;
                    return `M${sx},${sy}Q${cx},${cy} ${tx},${ty}`;
                });

                this.linkLabelsGroup.selectAll('text')
                    .attr('x', d => {
                        // @ts-ignore
                        const sx = d.source.x;
                        // @ts-ignore
                        const sy = d.source.y;
                        // @ts-ignore
                        const tx = d.target.x;
                        // @ts-ignore
                        const ty = d.target.y;
                        // @ts-ignore
                        const sourceId = d.source.id;
                        // @ts-ignore
                        const targetId = d.target.id;
                        const hasReverse = reverseLookup.has(`${sourceId}->${targetId}`) && reverseLookup.has(`${targetId}->${sourceId}`);
                        if (!hasReverse) return (sx + tx) / 2;

                        const dx = tx - sx;
                        const dy = ty - sy;
                        const length = Math.sqrt(dx * dx + dy * dy) || 1;
                        const nx = -dy / length;
                        const direction = sourceId < targetId ? 1 : -1;
                        return (sx + tx) / 2 + nx * length * 0.15 * direction;
                    })
                    .attr('y', d => {
                        // @ts-ignore
                        const sx = d.source.x;
                        // @ts-ignore
                        const sy = d.source.y;
                        // @ts-ignore
                        const tx = d.target.x;
                        // @ts-ignore
                        const ty = d.target.y;
                        // @ts-ignore
                        const sourceId = d.source.id;
                        // @ts-ignore
                        const targetId = d.target.id;
                        const hasReverse = reverseLookup.has(`${sourceId}->${targetId}`) && reverseLookup.has(`${targetId}->${sourceId}`);
                        if (!hasReverse) return (sy + ty) / 2 - 4;

                        const dx = tx - sx;
                        const dy = ty - sy;
                        const length = Math.sqrt(dx * dx + dy * dy) || 1;
                        const ny = dx / length;
                        const direction = sourceId < targetId ? 1 : -1;
                        return (sy + ty) / 2 + ny * length * 0.15 * direction - 4;
                    });

                allNodes.attr("transform", d => `translate(${// @ts-ignore
                    d.x},${// @ts-ignore
                    d.y})`);
            });

        // @ts-ignore
        this.simulation.force("link").links(filteredLinks);
        this.simulation.alpha(1).restart();

        const topLinks = linksData
            .sort((a, b) => b.value - a.value)
            .slice(0, 5)
            .map(d => ({
                source: d.source,
                target: d.target,
                value: d.value,
                normalizedValue: d.value / (sourceTotals[d.source] || 1)
            }));

        return {
            totalTransitions: transitions.length,
            shownTransitions: d3.sum(filteredLinks, d => d.value),
            nodeCount: nodesData.length,
            linkCount: filteredLinks.length,
            topLinks
        };
    }
}
