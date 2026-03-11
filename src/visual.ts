"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import mapboxgl from "mapbox-gl";
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import DataView = powerbi.DataView;

import { VisualFormattingSettingsModel } from "./settings";

/** A parsed segment from a route string: [carrier][origin][dest] */
interface ParsedSegment {
    carrier: string;
    origin: string;
    dest: string;
}

interface LegData {
    originName: string;
    destName: string;
    originCode: string;
    destCode: string;
    carrierCode: string;
    originLat: number;
    originLon: number;
    destLat: number;
    destLon: number;
    measures: { name: string; value: number }[];
    totalValue: number;
    legIndex: number; // position within the route string
    selectionId: ISelectionId | null;
}

interface RouteData {
    rteStrs: string;
    legs: LegData[];
    stops: { name: string; code: string; lat: number; lon: number }[];
    totalValue: number;
    totalMeasures: { name: string; value: number }[];
}

interface NodeData {
    name: string;
    lat: number;
    lon: number;
    totalFlow: number;
}

export class Visual implements IVisual {
    private target: HTMLElement;
    private host: IVisualHost;
    private selectionManager: ISelectionManager;
    private mapContainer: HTMLDivElement;
    private canvasOverlay: HTMLCanvasElement;
    private tooltipEl: HTMLDivElement;
    private landingPage: HTMLDivElement;
    private map: mapboxgl.Map | null = null;
    private routes: RouteData[] = [];
    private nodes: Map<string, NodeData> = new Map();
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;
    private animationFrame: number = 0;
    private animationTime: number = 0;
    private lastTimestamp: number = 0;
    private isMapReady: boolean = false;
    private currentMapStyle: string = "";
    private currentToken: string = "";
    private maxRouteValue: number = 1;
    private hoveredRouteIndex: number = -1;
    private hoveredLegIndex: number = -1;
    private dataView: DataView | null = null;

    private readonly DEFAULT_TOKEN = "";

    constructor(options: VisualConstructorOptions) {
        this.formattingSettingsService = new FormattingSettingsService();
        this.host = options.host;
        this.selectionManager = this.host.createSelectionManager();
        this.target = options.element;
        this.target.style.overflow = "hidden";
        this.target.style.position = "relative";

        this.mapContainer = document.createElement("div");
        this.mapContainer.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;";
        this.target.appendChild(this.mapContainer);

        this.canvasOverlay = document.createElement("canvas");
        this.canvasOverlay.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;";
        this.target.appendChild(this.canvasOverlay);

        this.tooltipEl = document.createElement("div");
        this.tooltipEl.className = "flow-tooltip";
        this.tooltipEl.style.display = "none";
        this.target.appendChild(this.tooltipEl);

        this.mapContainer.addEventListener("mousemove", (e) => this.handleMouseMove(e));
        this.mapContainer.addEventListener("mouseleave", () => this.hideTooltip());
        this.mapContainer.addEventListener("click", (e) => this.handleClick(e));
        this.mapContainer.addEventListener("contextmenu", (e) => this.handleContextMenu(e));

        // Landing page shown before data is loaded
        this.landingPage = document.createElement("div");
        this.landingPage.className = "landing-page";
        this.buildLandingPage();
        this.target.appendChild(this.landingPage);
    }

    private initMap(token: string, style: string) {
        if (this.map) {
            this.map.remove();
            this.map = null;
            this.isMapReady = false;
        }

        const accessToken = token || this.DEFAULT_TOKEN;
        (mapboxgl as any).accessToken = accessToken;
        this.currentToken = accessToken;
        this.currentMapStyle = style;

        this.map = new mapboxgl.Map({
            container: this.mapContainer,
            style: `mapbox://styles/mapbox/${style}`,
            center: [-85, 38],
            zoom: 4,
            attributionControl: false,
            preserveDrawingBuffer: true
        });

        this.map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");

        this.map.on("load", () => {
            this.isMapReady = true;
            this.renderFlows();
        });

        this.map.on("move", () => { if (this.isMapReady) this.renderFlows(); });
        this.map.on("zoom", () => { if (this.isMapReady) this.renderFlows(); });
        this.map.on("resize", () => { if (this.isMapReady) this.renderFlows(); });
    }

    public update(options: VisualUpdateOptions) {
        const hasData = options.dataViews && options.dataViews[0]
            && options.dataViews[0].categorical
            && options.dataViews[0].categorical.values
            && options.dataViews[0].categorical.values.length > 0;

        if (!hasData) {
            this.landingPage.style.display = "flex";
            this.mapContainer.style.display = "none";
            this.canvasOverlay.style.display = "none";
            return;
        }
        this.landingPage.style.display = "none";
        this.mapContainer.style.display = "block";
        this.canvasOverlay.style.display = "block";

        if (!options.dataViews || !options.dataViews[0]) return;

        this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(
            VisualFormattingSettingsModel, options.dataViews[0]
        );

        const mapStyle = this.formattingSettings.mapSettingsCard.mapStyle.value?.value as string || "dark-v11";
        const token = this.formattingSettings.mapSettingsCard.mapboxToken.value || "";
        const effectiveToken = token || this.DEFAULT_TOKEN;

        if (!this.map || this.currentMapStyle !== mapStyle || this.currentToken !== effectiveToken) {
            this.initMap(effectiveToken, mapStyle);
        }

        this.dataView = options.dataViews[0];
        this.parseData(this.dataView);

        const w = this.target.clientWidth;
        const h = this.target.clientHeight;
        if (this.canvasOverlay.width !== w * 2 || this.canvasOverlay.height !== h * 2) {
            this.canvasOverlay.width = w * 2;
            this.canvasOverlay.height = h * 2;
            this.canvasOverlay.style.width = w + "px";
            this.canvasOverlay.style.height = h + "px";
        }

        if (this.isMapReady) {
            this.fitMapToData();
            this.renderFlows();
        }
    }

    /**
     * Parse a route string like "125AL0E62-500E62I60-600I60J10-320J10000"
     * into ordered segments: [{carrier:"125",origin:"AL0",dest:"E62"}, ...]
     */
    private parseRouteString(rteStrs: string): ParsedSegment[] {
        if (!rteStrs) return [];
        const parts = rteStrs.split("-");
        const segments: ParsedSegment[] = [];
        for (const part of parts) {
            if (part.length < 9) continue;
            segments.push({
                carrier: part.substring(0, 3),
                origin: part.substring(3, 6),
                dest: part.substring(6, 9)
            });
        }
        return segments;
    }

    private parseData(dataView: DataView) {
        this.routes = [];
        this.nodes = new Map();

        if (!dataView.categorical) return;

        const cats = dataView.categorical.categories;
        const vals = dataView.categorical.values;
        if (!cats || !vals) return;

        // Category columns
        const rteStrsCol = cats.find(c => c.source.roles?.["rteStrs"]);
        const legOrigCodeCol = cats.find(c => c.source.roles?.["legOrigCode"]);
        const legDestCodeCol = cats.find(c => c.source.roles?.["legDestCode"]);
        const originNameCol = cats.find(c => c.source.roles?.["originName"]);
        const destNameCol = cats.find(c => c.source.roles?.["destName"]);

        // Measure columns
        const originLatCol = vals.find(v => v.source.roles?.["originLat"]);
        const originLonCol = vals.find(v => v.source.roles?.["originLon"]);
        const destLatCol = vals.find(v => v.source.roles?.["destLat"]);
        const destLonCol = vals.find(v => v.source.roles?.["destLon"]);
        const valueCols = vals.filter(v => v.source.roles?.["values"]);

        if (!originLatCol || !originLonCol || !destLatCol || !destLonCol) return;

        const rowCount = originLatCol.values.length;

        // Collect raw legs grouped by rte_strs
        const routeMap = new Map<string, LegData[]>();

        for (let i = 0; i < rowCount; i++) {
            const oLat = Number(originLatCol.values[i]);
            const oLon = Number(originLonCol.values[i]);
            const dLat = Number(destLatCol.values[i]);
            const dLon = Number(destLonCol.values[i]);

            if (isNaN(oLat) || isNaN(oLon) || isNaN(dLat) || isNaN(dLon)) continue;
            if (oLat === 0 && oLon === 0 && dLat === 0 && dLon === 0) continue;

            const origCode = legOrigCodeCol ? String(legOrigCodeCol.values[i] ?? "") : "";
            const destCode = legDestCodeCol ? String(legDestCodeCol.values[i] ?? "") : "";
            const oName = originNameCol ? String(originNameCol.values[i] ?? origCode) : origCode || `${oLat.toFixed(2)},${oLon.toFixed(2)}`;
            const dName = destNameCol ? String(destNameCol.values[i] ?? destCode) : destCode || `${dLat.toFixed(2)},${dLon.toFixed(2)}`;

            const measures: { name: string; value: number }[] = [];
            let totalVal = 0;
            for (const vc of valueCols) {
                const v = Number(vc.values[i]) || 0;
                measures.push({ name: vc.source.displayName, value: v });
                totalVal += Math.abs(v);
            }

            const rteStr = rteStrsCol ? String(rteStrsCol.values[i] ?? "") : "";

            // Build selectionId for cross-filtering
            let selectionId: ISelectionId | null = null;
            if (rteStrsCol) {
                const builder = this.host.createSelectionIdBuilder();
                builder.withCategory(rteStrsCol, i);
                selectionId = builder.createSelectionId();
            }

            const leg: LegData = {
                originName: oName, destName: dName,
                originCode: origCode, destCode: destCode,
                carrierCode: "",
                originLat: oLat, originLon: oLon,
                destLat: dLat, destLon: dLon,
                measures, totalValue: totalVal,
                legIndex: -1,
                selectionId
            };

            // Group by rte_strs; if not provided, each leg is its own route
            const key = rteStr || `leg_${i}`;
            if (!routeMap.has(key)) routeMap.set(key, []);
            routeMap.get(key)!.push(leg);

            // Build node map
            const oKey = `${oLat.toFixed(4)},${oLon.toFixed(4)}`;
            const dKey = `${dLat.toFixed(4)},${dLon.toFixed(4)}`;
            if (!this.nodes.has(oKey)) this.nodes.set(oKey, { name: oName, lat: oLat, lon: oLon, totalFlow: 0 });
            this.nodes.get(oKey)!.totalFlow += totalVal;
            if (!this.nodes.has(dKey)) this.nodes.set(dKey, { name: dName, lat: dLat, lon: dLon, totalFlow: 0 });
            this.nodes.get(dKey)!.totalFlow += totalVal;
        }

        // Build routes with intelligent leg ordering
        this.maxRouteValue = 0;
        for (const [rteStr, legs] of routeMap) {
            const orderedLegs = this.orderLegs(rteStr, legs);
            const stops = this.buildStops(orderedLegs);

            // Aggregate measures across all legs
            const measureNames = orderedLegs.length > 0 ? orderedLegs[0].measures.map(m => m.name) : [];
            const totalMeasures = measureNames.map(name => {
                const sum = orderedLegs.reduce((acc, leg) => {
                    const found = leg.measures.find(m => m.name === name);
                    return acc + (found ? found.value : 0);
                }, 0);
                return { name, value: sum };
            });
            const totalValue = orderedLegs.reduce((acc, l) => acc + l.totalValue, 0);

            if (totalValue > this.maxRouteValue) this.maxRouteValue = totalValue;

            this.routes.push({ rteStrs: rteStr, legs: orderedLegs, stops, totalValue, totalMeasures });
        }

        if (this.maxRouteValue === 0) this.maxRouteValue = 1;
    }

    /**
     * Order legs using the parsed route string for precise sequencing.
     * Falls back to coordinate-based chaining if codes aren't available.
     */
    private orderLegs(rteStr: string, legs: LegData[]): LegData[] {
        if (legs.length <= 1) return legs;

        // Try to order using the route string
        const segments = this.parseRouteString(rteStr);
        if (segments.length > 0 && legs[0].originCode) {
            // Match each leg to its position in the route string
            const ordered: LegData[] = [];
            const remaining = [...legs];

            for (let si = 0; si < segments.length; si++) {
                const seg = segments[si];
                const matchIdx = remaining.findIndex(l =>
                    l.originCode === seg.origin && l.destCode === seg.dest
                );
                if (matchIdx >= 0) {
                    const leg = remaining.splice(matchIdx, 1)[0];
                    leg.legIndex = si;
                    leg.carrierCode = seg.carrier;
                    ordered.push(leg);
                }
            }

            // Append any unmatched legs at the end
            ordered.push(...remaining);
            if (ordered.length > 0) return ordered;
        }

        // Fallback: chain by matching dest coords to next origin coords
        return this.chainLegsByCoords(legs);
    }

    private chainLegsByCoords(legs: LegData[]): LegData[] {
        const remaining = [...legs];
        const ordered: LegData[] = [];

        // Find start: leg whose origin is not any other leg's destination
        const destKeys = new Set(remaining.map(l => `${l.destLat.toFixed(4)},${l.destLon.toFixed(4)}`));
        let startIdx = remaining.findIndex(l => !destKeys.has(`${l.originLat.toFixed(4)},${l.originLon.toFixed(4)}`));
        if (startIdx === -1) startIdx = 0;

        ordered.push(remaining.splice(startIdx, 1)[0]);

        while (remaining.length > 0) {
            const last = ordered[ordered.length - 1];
            const nextIdx = remaining.findIndex(l =>
                Math.abs(l.originLat - last.destLat) < 0.01 &&
                Math.abs(l.originLon - last.destLon) < 0.01
            );
            if (nextIdx === -1) break;
            ordered.push(remaining.splice(nextIdx, 1)[0]);
        }

        ordered.push(...remaining);
        return ordered;
    }

    private buildStops(legs: LegData[]): { name: string; code: string; lat: number; lon: number }[] {
        if (legs.length === 0) return [];
        const stops: { name: string; code: string; lat: number; lon: number }[] = [];
        stops.push({
            name: legs[0].originName,
            code: legs[0].originCode,
            lat: legs[0].originLat,
            lon: legs[0].originLon
        });
        for (const leg of legs) {
            stops.push({
                name: leg.destName,
                code: leg.destCode,
                lat: leg.destLat,
                lon: leg.destLon
            });
        }
        return stops;
    }

    private fitMapToData() {
        if (!this.map || this.routes.length === 0) return;

        const bounds = new mapboxgl.LngLatBounds();
        for (const route of this.routes) {
            for (const stop of route.stops) {
                bounds.extend([stop.lon, stop.lat]);
            }
        }

        this.map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 800 });
    }

    private project(lon: number, lat: number): [number, number] | null {
        if (!this.map) return null;
        const p = this.map.project([lon, lat]);
        return [p.x * 2, p.y * 2];
    }

    private getBezierPoint(
        x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, t: number
    ): [number, number] {
        const mt = 1 - t;
        return [
            mt * mt * x0 + 2 * mt * t * cx + t * t * x1,
            mt * mt * y0 + 2 * mt * t * cy + t * t * y1
        ];
    }

    private computeControlPoint(p0: [number, number], p1: [number, number], curveHeightPct: number): [number, number] {
        const dx = p1[0] - p0[0];
        const dy = p1[1] - p0[1];
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) return [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
        const mx = (p0[0] + p1[0]) / 2;
        const my = (p0[1] + p1[1]) / 2;
        const curveOffset = dist * curveHeightPct * 0.5;
        const nx = -dy / dist;
        const ny = dx / dist;
        return [mx + nx * curveOffset, my + ny * curveOffset - curveOffset * 0.3];
    }

    private renderFlows() {
        if (this.animationFrame) cancelAnimationFrame(this.animationFrame);

        const showAnim = this.formattingSettings?.flowSettingsCard?.showAnimation?.value ?? true;
        if (showAnim) {
            this.lastTimestamp = 0;
            this.animate(performance.now());
        } else {
            this.drawFrame(0);
        }
    }

    private animate = (timestamp: number) => {
        const speed = (this.formattingSettings?.flowSettingsCard?.animationSpeed?.value ?? 50) / 50;
        if (this.lastTimestamp === 0) this.lastTimestamp = timestamp;
        const dt = (timestamp - this.lastTimestamp) * 0.001 * speed;
        this.lastTimestamp = timestamp;
        this.animationTime = (this.animationTime + dt) % 100;

        this.drawFrame(this.animationTime);
        this.animationFrame = requestAnimationFrame(this.animate);
    };

    private hexToRgb(hex: string): [number, number, number] {
        hex = hex.replace("#", "");
        return [
            parseInt(hex.substring(0, 2), 16),
            parseInt(hex.substring(2, 4), 16),
            parseInt(hex.substring(4, 6), 16)
        ];
    }

    private lerpColor(c1: [number, number, number], c2: [number, number, number], t: number): string {
        const r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
        const g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
        const b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
        return `rgb(${r},${g},${b})`;
    }

    private drawFrame(time: number) {
        const ctx = this.canvasOverlay.getContext("2d");
        if (!ctx || !this.map) return;

        const w = this.canvasOverlay.width;
        const h = this.canvasOverlay.height;
        ctx.clearRect(0, 0, w, h);

        if (this.routes.length === 0) return;

        const settings = this.formattingSettings;
        const arcColorStart = settings?.flowSettingsCard?.arcColor?.value?.value || "#00d4ff";
        const arcColorEnd = settings?.flowSettingsCard?.arcColorEnd?.value?.value || "#ff6b35";
        const baseWidth = settings?.flowSettingsCard?.arcWidth?.value ?? 2;
        const arcOpacity = (settings?.flowSettingsCard?.arcOpacity?.value ?? 60) / 100;
        const particleSize = (settings?.flowSettingsCard?.particleSize?.value ?? 4) * 2;
        const curveHeightPct = (settings?.flowSettingsCard?.curveHeight?.value ?? 50) / 100;
        const showNodes = settings?.nodeSettingsCard?.showNodes?.value ?? true;
        const nodeColor = settings?.nodeSettingsCard?.nodeColor?.value?.value || "#ffffff";
        const nodeSize = (settings?.nodeSettingsCard?.nodeSize?.value ?? 6) * 2;
        const showLabels = settings?.nodeSettingsCard?.showLabels?.value ?? true;
        const labelColor = settings?.nodeSettingsCard?.labelColor?.value?.value || "#ffffff";
        const labelSize = (settings?.nodeSettingsCard?.labelSize?.value ?? 11) * 2;
        const showAnim = settings?.flowSettingsCard?.showAnimation?.value ?? true;

        const rgb1 = this.hexToRgb(arcColorStart);
        const rgb2 = this.hexToRgb(arcColorEnd);

        // Draw routes
        for (let ri = 0; ri < this.routes.length; ri++) {
            const route = this.routes[ri];
            const isHoveredRoute = ri === this.hoveredRouteIndex;
            const widthScale = Math.max(0.3, Math.min(1.5, route.totalValue / this.maxRouteValue));
            const totalLegs = route.legs.length;

            for (let li = 0; li < totalLegs; li++) {
                const leg = route.legs[li];
                const p0 = this.project(leg.originLon, leg.originLat);
                const p1 = this.project(leg.destLon, leg.destLat);
                if (!p0 || !p1) continue;

                const isHoveredLeg = isHoveredRoute && li === this.hoveredLegIndex;
                const lineWidth = baseWidth * 2 * widthScale * (isHoveredRoute ? 1.8 : 1);
                const opacity = isHoveredRoute ? 0.95 : arcOpacity;

                const cp = this.computeControlPoint(p0, p1, curveHeightPct);
                const dx = p1[0] - p0[0];
                const dy = p1[1] - p0[1];
                const dist = Math.sqrt(dx * dx + dy * dy);

                // Color gradient position within the full route
                const tStart = totalLegs > 1 ? li / totalLegs : 0;
                const tEnd = totalLegs > 1 ? (li + 1) / totalLegs : 1;

                // Draw gradient arc segments
                const steps = Math.max(20, Math.floor(dist / 8));
                ctx.lineWidth = lineWidth;
                ctx.lineCap = "round";

                for (let s = 0; s < steps; s++) {
                    const st0 = s / steps;
                    const st1 = (s + 1) / steps;
                    const [x0, y0] = this.getBezierPoint(p0[0], p0[1], cp[0], cp[1], p1[0], p1[1], st0);
                    const [x1, y1] = this.getBezierPoint(p0[0], p0[1], cp[0], cp[1], p1[0], p1[1], st1);

                    const globalT = tStart + st0 * (tEnd - tStart);
                    ctx.beginPath();
                    ctx.moveTo(x0, y0);
                    ctx.lineTo(x1, y1);
                    ctx.strokeStyle = this.lerpColor(rgb1, rgb2, globalT);
                    ctx.globalAlpha = opacity * (0.4 + 0.6 * Math.sin(st0 * Math.PI));
                    ctx.stroke();
                }

                // Glow for hovered leg
                if (isHoveredLeg) {
                    ctx.lineWidth = lineWidth + 8;
                    ctx.globalAlpha = 0.2;
                    ctx.beginPath();
                    ctx.moveTo(p0[0], p0[1]);
                    ctx.quadraticCurveTo(cp[0], cp[1], p1[0], p1[1]);
                    ctx.strokeStyle = this.lerpColor(rgb1, rgb2, (tStart + tEnd) / 2);
                    ctx.stroke();
                }

                // Animated particles flowing through the entire route
                if (showAnim) {
                    const numParticles = Math.max(1, Math.ceil(widthScale * 2));
                    for (let pi = 0; pi < numParticles; pi++) {
                        const globalParticleT = ((time * 0.3 + pi * (1 / numParticles)) % 1);
                        const legStart = totalLegs > 1 ? li / totalLegs : 0;
                        const legEnd = totalLegs > 1 ? (li + 1) / totalLegs : 1;

                        if (globalParticleT < legStart || globalParticleT > legEnd) continue;

                        const localT = (globalParticleT - legStart) / (legEnd - legStart);
                        const [px, py] = this.getBezierPoint(p0[0], p0[1], cp[0], cp[1], p1[0], p1[1], localT);

                        const size = particleSize * (0.5 + widthScale * 0.5) * (isHoveredRoute ? 1.5 : 1);
                        const color = this.lerpColor(rgb1, rgb2, globalParticleT);

                        // Outer glow
                        const glowGrad = ctx.createRadialGradient(px, py, 0, px, py, size * 3);
                        glowGrad.addColorStop(0, color);
                        glowGrad.addColorStop(1, "transparent");
                        ctx.globalAlpha = 0.35 * (isHoveredRoute ? 1.5 : 1);
                        ctx.fillStyle = glowGrad;
                        ctx.beginPath();
                        ctx.arc(px, py, size * 3, 0, Math.PI * 2);
                        ctx.fill();

                        // Core white
                        ctx.globalAlpha = 0.95;
                        ctx.fillStyle = "#ffffff";
                        ctx.beginPath();
                        ctx.arc(px, py, size * 0.5, 0, Math.PI * 2);
                        ctx.fill();

                        // Colored ring
                        ctx.globalAlpha = 0.8;
                        ctx.fillStyle = color;
                        ctx.beginPath();
                        ctx.arc(px, py, size, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }
        }

        // Draw nodes
        if (showNodes) {
            ctx.globalAlpha = 1;
            const maxNodeFlow = Math.max(...Array.from(this.nodes.values()).map(n => n.totalFlow), 1);

            for (const node of this.nodes.values()) {
                const p = this.project(node.lon, node.lat);
                if (!p) continue;

                const sizeScale = 0.6 + 0.4 * (node.totalFlow / maxNodeFlow);
                const r = nodeSize * sizeScale;

                // Outer glow
                const glowGrad = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r * 3);
                glowGrad.addColorStop(0, nodeColor + "66");
                glowGrad.addColorStop(1, "transparent");
                ctx.fillStyle = glowGrad;
                ctx.beginPath();
                ctx.arc(p[0], p[1], r * 3, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = nodeColor;
                ctx.beginPath();
                ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = arcColorStart;
                ctx.beginPath();
                ctx.arc(p[0], p[1], r * 0.5, 0, Math.PI * 2);
                ctx.fill();

                if (showLabels) {
                    ctx.font = `600 ${labelSize}px 'Segoe UI', system-ui, sans-serif`;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "bottom";
                    ctx.fillStyle = "rgba(0,0,0,0.7)";
                    ctx.fillText(node.name, p[0] + 2, p[1] - r - 6);
                    ctx.fillStyle = labelColor;
                    ctx.fillText(node.name, p[0], p[1] - r - 8);
                }
            }
        }

        ctx.globalAlpha = 1;
    }

    private handleMouseMove(e: MouseEvent) {
        if (!this.map || this.routes.length === 0) return;

        const rect = this.mapContainer.getBoundingClientRect();
        const mx = (e.clientX - rect.left) * 2;
        const my = (e.clientY - rect.top) * 2;

        const curveHeightPct = (this.formattingSettings?.flowSettingsCard?.curveHeight?.value ?? 50) / 100;

        let closestDist = 30;
        let closestRouteIdx = -1;
        let closestLegIdx = -1;

        for (let ri = 0; ri < this.routes.length; ri++) {
            for (let li = 0; li < this.routes[ri].legs.length; li++) {
                const leg = this.routes[ri].legs[li];
                const p0 = this.project(leg.originLon, leg.originLat);
                const p1 = this.project(leg.destLon, leg.destLat);
                if (!p0 || !p1) continue;

                const cp = this.computeControlPoint(p0, p1, curveHeightPct);

                for (let t = 0; t <= 1; t += 0.05) {
                    const [bx, by] = this.getBezierPoint(p0[0], p0[1], cp[0], cp[1], p1[0], p1[1], t);
                    const d = Math.sqrt((bx - mx) ** 2 + (by - my) ** 2);
                    if (d < closestDist) {
                        closestDist = d;
                        closestRouteIdx = ri;
                        closestLegIdx = li;
                    }
                }
            }
        }

        if (closestRouteIdx !== this.hoveredRouteIndex || closestLegIdx !== this.hoveredLegIndex) {
            this.hoveredRouteIndex = closestRouteIdx;
            this.hoveredLegIndex = closestLegIdx;
            if (closestRouteIdx >= 0) {
                this.showTooltip(e, this.routes[closestRouteIdx], closestLegIdx);
            } else {
                this.hideTooltip();
            }
        } else if (closestRouteIdx >= 0) {
            this.positionTooltip(e);
        }
    }

    private formatNumber(val: number): string {
        if (Math.abs(val) >= 1e9) return (val / 1e9).toFixed(1) + "B";
        if (Math.abs(val) >= 1e6) return (val / 1e6).toFixed(1) + "M";
        if (Math.abs(val) >= 1e3) return (val / 1e3).toFixed(1) + "K";
        if (Number.isInteger(val)) return val.toString();
        return val.toFixed(2);
    }

    private createEl(tag: string, className?: string, text?: string): HTMLElement {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text) el.textContent = text;
        return el;
    }

    private showTooltip(e: MouseEvent, route: RouteData, hoveredLegIdx: number) {
        const arcColorStart = this.formattingSettings?.flowSettingsCard?.arcColor?.value?.value || "#00d4ff";
        const arcColorEnd = this.formattingSettings?.flowSettingsCard?.arcColorEnd?.value?.value || "#ff6b35";
        const rgb1 = this.hexToRgb(arcColorStart);
        const rgb2 = this.hexToRgb(arcColorEnd);

        while (this.tooltipEl.firstChild) this.tooltipEl.removeChild(this.tooltipEl.firstChild);

        // Route path header: stop1 → stop2 → stop3 → ...
        const header = this.createEl("div", "tooltip-header");
        const routeEl = this.createEl("div", "tooltip-route-path");

        for (let si = 0; si < route.stops.length; si++) {
            const stop = route.stops[si];
            const t = route.stops.length > 1 ? si / (route.stops.length - 1) : 0;
            const color = this.lerpColor(rgb1, rgb2, t);

            const isActive = si === hoveredLegIdx || si === hoveredLegIdx + 1;
            const label = stop.name || stop.code;
            const stopEl = this.createEl("span", isActive ? "tooltip-stop active" : "tooltip-stop", label);
            stopEl.style.color = color;
            if (isActive) stopEl.style.fontWeight = "700";
            routeEl.appendChild(stopEl);

            if (si < route.stops.length - 1) {
                const arrow = this.createEl("span", "tooltip-arrow-sm", "\u2192");
                routeEl.appendChild(arrow);
            }
        }

        header.appendChild(routeEl);

        // Show leg count below the path if multi-leg
        if (route.legs.length > 1) {
            const legCount = this.createEl("div", "tooltip-rte-str", `${route.legs.length}-leg route`);
            header.appendChild(legCount);
        }

        this.tooltipEl.appendChild(header);
        this.tooltipEl.appendChild(this.createEl("div", "tooltip-divider"));

        // Hovered leg detail
        if (hoveredLegIdx >= 0 && hoveredLegIdx < route.legs.length) {
            const leg = route.legs[hoveredLegIdx];
            const legHeader = this.createEl("div", "tooltip-leg-header");
            const carrierStr = leg.carrierCode ? ` [${leg.carrierCode}]` : "";
            legHeader.appendChild(this.createEl("span", "tooltip-leg-label",
                `Leg ${hoveredLegIdx + 1}${carrierStr}: ${leg.originName || leg.originCode} \u2192 ${leg.destName || leg.destCode}`));
            this.tooltipEl.appendChild(legHeader);

            if (leg.measures.length > 0) {
                const legBody = this.createEl("div", "tooltip-body");
                for (const m of leg.measures) {
                    const row = this.createEl("div", "tooltip-row");
                    row.appendChild(this.createEl("span", "tooltip-label", m.name));
                    row.appendChild(this.createEl("span", "tooltip-value", this.formatNumber(m.value)));
                    legBody.appendChild(row);
                }
                this.tooltipEl.appendChild(legBody);
            }

            if (route.legs.length > 1) {
                this.tooltipEl.appendChild(this.createEl("div", "tooltip-divider-light"));
            }
        }

        // Route totals
        if (route.legs.length > 1 && route.totalMeasures.length > 0) {
            const totalHeader = this.createEl("div", "tooltip-leg-header");
            totalHeader.appendChild(this.createEl("span", "tooltip-total-label", `Route Total (${route.legs.length} legs)`));
            this.tooltipEl.appendChild(totalHeader);

            const body = this.createEl("div", "tooltip-body");
            for (const m of route.totalMeasures) {
                const barPct = this.maxRouteValue > 0 ? (Math.abs(m.value) / this.maxRouteValue) * 100 : 0;

                const row = this.createEl("div", "tooltip-row");
                row.appendChild(this.createEl("span", "tooltip-label", m.name));
                row.appendChild(this.createEl("span", "tooltip-value-lg", this.formatNumber(m.value)));
                body.appendChild(row);

                const barBg = this.createEl("div", "tooltip-bar-bg");
                const bar = this.createEl("div", "tooltip-bar");
                bar.style.width = Math.max(2, barPct) + "%";
                bar.style.background = `linear-gradient(90deg,${arcColorStart},${arcColorEnd})`;
                barBg.appendChild(bar);
                body.appendChild(barBg);
            }
            this.tooltipEl.appendChild(body);
        } else if (route.totalMeasures.length > 0) {
            // Single leg route — show measures with bars
            const body = this.createEl("div", "tooltip-body");
            for (const m of route.totalMeasures) {
                const barPct = this.maxRouteValue > 0 ? (Math.abs(m.value) / this.maxRouteValue) * 100 : 0;

                const row = this.createEl("div", "tooltip-row");
                row.appendChild(this.createEl("span", "tooltip-label", m.name));
                row.appendChild(this.createEl("span", "tooltip-value", this.formatNumber(m.value)));
                body.appendChild(row);

                const barBg = this.createEl("div", "tooltip-bar-bg");
                const bar = this.createEl("div", "tooltip-bar");
                bar.style.width = Math.max(2, barPct) + "%";
                bar.style.background = `linear-gradient(90deg,${arcColorStart},${arcColorEnd})`;
                barBg.appendChild(bar);
                body.appendChild(barBg);
            }
            this.tooltipEl.appendChild(body);
        }

        this.tooltipEl.style.display = "block";
        this.positionTooltip(e);
    }

    private positionTooltip(e: MouseEvent) {
        const rect = this.target.getBoundingClientRect();
        let x = e.clientX - rect.left + 16;
        let y = e.clientY - rect.top - 10;

        const tw = this.tooltipEl.offsetWidth;
        const th = this.tooltipEl.offsetHeight;

        if (x + tw > rect.width) x = e.clientX - rect.left - tw - 16;
        if (y + th > rect.height) y = rect.height - th - 8;
        if (y < 0) y = 8;

        this.tooltipEl.style.left = x + "px";
        this.tooltipEl.style.top = y + "px";
    }

    private hideTooltip() {
        this.hoveredRouteIndex = -1;
        this.hoveredLegIndex = -1;
        this.tooltipEl.style.display = "none";
    }

    private handleClick(e: MouseEvent) {
        const hit = this.hitTest(e);
        if (hit && hit.route) {
            // Collect all selectionIds from the route's legs
            const ids = hit.route.legs
                .map(l => l.selectionId)
                .filter((id): id is ISelectionId => id !== null);

            if (ids.length > 0) {
                this.selectionManager.select(ids, e.ctrlKey || e.metaKey).then(() => {
                    this.renderFlows();
                });
            }
        } else {
            // Click on empty space clears selection
            this.selectionManager.clear().then(() => {
                this.renderFlows();
            });
        }
    }

    private handleContextMenu(e: MouseEvent) {
        e.preventDefault();
        const hit = this.hitTest(e);
        let selectionId: ISelectionId | null = null;
        if (hit && hit.route && hit.legIdx >= 0) {
            selectionId = hit.route.legs[hit.legIdx]?.selectionId || null;
        }

        const point = {
            x: e.clientX,
            y: e.clientY
        };

        this.selectionManager.showContextMenu(
            selectionId || {} as ISelectionId,
            point
        );
    }

    private buildLandingPage() {
        const content = this.createEl("div", "landing-content");

        // SVG icon built via DOM
        const NS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(NS, "svg");
        svg.setAttribute("width", "64");
        svg.setAttribute("height", "64");
        svg.setAttribute("viewBox", "0 0 64 64");

        const defs = document.createElementNS(NS, "defs");
        const makeGrad = (id: string, c1: string, c2: string) => {
            const g = document.createElementNS(NS, "linearGradient");
            g.setAttribute("id", id); g.setAttribute("x1", "0%"); g.setAttribute("y1", "0%");
            g.setAttribute("x2", "100%"); g.setAttribute("y2", "0%");
            const s1 = document.createElementNS(NS, "stop");
            s1.setAttribute("offset", "0%"); s1.setAttribute("style", `stop-color:${c1}`);
            const s2 = document.createElementNS(NS, "stop");
            s2.setAttribute("offset", "100%"); s2.setAttribute("style", `stop-color:${c2}`);
            g.appendChild(s1); g.appendChild(s2);
            return g;
        };
        defs.appendChild(makeGrad("lg1", "#00d4ff", "#ff6b35"));
        defs.appendChild(makeGrad("lg2", "#a78bfa", "#ff6b9d"));
        svg.appendChild(defs);

        const makePath = (d: string, stroke: string, sw: string) => {
            const p = document.createElementNS(NS, "path");
            p.setAttribute("d", d); p.setAttribute("fill", "none");
            p.setAttribute("stroke", stroke); p.setAttribute("stroke-width", sw);
            p.setAttribute("stroke-linecap", "round");
            return p;
        };
        svg.appendChild(makePath("M 10 45 Q 32 8 54 25", "url(#lg1)", "3"));
        svg.appendChild(makePath("M 10 32 Q 36 10 54 42", "url(#lg2)", "2.5"));

        const makeCircle = (cx: string, cy: string, r: string, fill: string) => {
            const c = document.createElementNS(NS, "circle");
            c.setAttribute("cx", cx); c.setAttribute("cy", cy);
            c.setAttribute("r", r); c.setAttribute("fill", fill);
            return c;
        };
        const nodeData = [
            ["10","45","4","#00d4ff"], ["10","45","1.5","#fff"],
            ["54","25","4","#ff6b35"], ["54","25","1.5","#fff"],
            ["10","32","3.5","#a78bfa"], ["10","32","1.3","#fff"],
            ["54","42","3.5","#ff6b9d"], ["54","42","1.3","#fff"]
        ];
        for (const [cx, cy, r, fill] of nodeData) {
            svg.appendChild(makeCircle(cx, cy, r, fill));
        }

        const iconDiv = this.createEl("div", "landing-icon");
        iconDiv.appendChild(svg);
        content.appendChild(iconDiv);
        content.appendChild(this.createEl("div", "landing-title", "RouteFlow Map"));
        content.appendChild(this.createEl("div", "landing-subtitle", "by Datayaga"));

        const steps = this.createEl("div", "landing-steps");
        const stepTexts = [
            "Set your Mapbox token in Format > Map Settings",
            "Drag origin/destination coordinates to Lat/Lon fields",
            "Add a measure to Values to size the flows",
            "Optionally add Route String for multi-leg routes"
        ];
        stepTexts.forEach((text, idx) => {
            const step = this.createEl("div", "landing-step");
            step.appendChild(this.createEl("span", "step-num", String(idx + 1)));
            step.appendChild(document.createTextNode(" " + text));
            steps.appendChild(step);
        });
        content.appendChild(steps);
        this.landingPage.appendChild(content);
    }

    private hitTest(e: MouseEvent): { route: RouteData; legIdx: number } | null {
        if (!this.map || this.routes.length === 0) return null;

        const rect = this.mapContainer.getBoundingClientRect();
        const mx = (e.clientX - rect.left) * 2;
        const my = (e.clientY - rect.top) * 2;
        const curveHeightPct = (this.formattingSettings?.flowSettingsCard?.curveHeight?.value ?? 50) / 100;

        let closestDist = 30;
        let closestRouteIdx = -1;
        let closestLegIdx = -1;

        for (let ri = 0; ri < this.routes.length; ri++) {
            for (let li = 0; li < this.routes[ri].legs.length; li++) {
                const leg = this.routes[ri].legs[li];
                const p0 = this.project(leg.originLon, leg.originLat);
                const p1 = this.project(leg.destLon, leg.destLat);
                if (!p0 || !p1) continue;

                const cp = this.computeControlPoint(p0, p1, curveHeightPct);

                for (let t = 0; t <= 1; t += 0.05) {
                    const [bx, by] = this.getBezierPoint(p0[0], p0[1], cp[0], cp[1], p1[0], p1[1], t);
                    const d = Math.sqrt((bx - mx) ** 2 + (by - my) ** 2);
                    if (d < closestDist) {
                        closestDist = d;
                        closestRouteIdx = ri;
                        closestLegIdx = li;
                    }
                }
            }
        }

        if (closestRouteIdx >= 0) {
            return { route: this.routes[closestRouteIdx], legIdx: closestLegIdx };
        }
        return null;
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
