/**
 * This module draws the map of the demo in an SVG element with d3-geo, and reads the pointer and the keys on it.
 *
 * - The globe is an orthographic projection. A drag turns it.
 * - The flat map is an equirectangular projection. A drag moves it east or west.
 * - A drag on the place moves the place. A tap moves the place, or adds a corner in the draw mode.
 * - The arrow keys turn the globe, and the keys with Shift move the place.
 */

import { type GeoPermissibleObjects, type GeoProjection, geoEquirectangular, geoGraticule10, geoOrthographic, geoPath } from "d3-geo";
import type { LatLon, Position } from "@mark1russell7/geo";
import { boxRing, bufferRing, densify, type Readout } from "./model.ts";

export type Projection = "globe" | "flat";

/** What the map draws. */
export interface Scene {
  readonly projection: Projection;
  /** The longitude and the latitude at the center of the view. */
  readonly center: readonly [lon: number, lat: number];
  /** The zoom of the view: 1 shows the whole globe or the whole world. */
  readonly zoom: number;
  readonly ring: readonly Position[] | undefined;
  readonly draft: readonly Position[];
  readonly place: LatLon;
  readonly result: Readout;
}

/** The events of the map. */
export interface MapEvents {
  readonly turn: (center: readonly [number, number]) => void;
  readonly place: (place: LatLon) => void;
  readonly tap: (point: LatLon) => void;
  /** A tap on the first corner of the draft. */
  readonly close: () => void;
}

const SIZE = { globe: { width: 600, height: 600 }, flat: { width: 720, height: 360 } } as const;
const NS = "http://www.w3.org/2000/svg";
const DRAG_PX = 4;

const clampLat = (lat: number): number => Math.max(-89.999, Math.min(89.999, lat));

/**
 * This function keeps the center of a view in its range. The globe turns to each latitude. The flat map moves north
 * or south only when the zoom shows a part of it. It does not show past a pole at any time.
 */
export function clampCenter(projection: Projection, zoom: number, center: readonly [number, number]): [number, number] {
  const lon = ((((center[0] + 180) % 360) + 360) % 360) - 180;
  if (projection === "globe") return [lon, clampLat(center[1])];
  const limit = 90 * (1 - 1 / zoom);
  return [lon, Math.max(-limit, Math.min(limit, center[1]))];
}

/** This function gives a GeoJSON Polygon for d3-geo from a ring that is clockwise. */
const shape = (ring: readonly [number, number][]): GeoPermissibleObjects => ({ type: "Polygon", coordinates: [ring.map(([x, y]) => [x, y])] });

/** This function gives the ring of geo as a ring for d3-geo: densified and clockwise. */
const areaShape = (ring: readonly Position[]): GeoPermissibleObjects => shape(densify(ring).reverse());

function element<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

/** The map of the demo. */
export class GeoMap {
  private readonly svg: SVGSVGElement;
  private readonly layers: Record<string, SVGPathElement>;
  private readonly corners: SVGGElement;
  private readonly place: SVGGElement;
  private readonly labels: SVGGElement;
  private readonly events: MapEvents;
  private projection: GeoProjection = geoOrthographic();
  private scene: Scene | undefined;

  constructor(svg: SVGSVGElement, events: MapEvents) {
    this.svg = svg;
    this.events = events;
    const names = ["sphere", "graticule", "equator", "antimeridian", "neighbors", "cell", "box", "area", "buffer", "draft"];
    this.layers = Object.fromEntries(names.map((name) => [name, element("path", { class: `layer ${name}` })]));
    this.corners = element("g", { class: "corners" });
    this.labels = element("g", { class: "labels", "aria-hidden": "true" });
    this.place = element("g", { class: "place-mark" });
    this.place.append(element("circle", { class: "halo", r: "16" }), element("circle", { class: "dot", r: "6" }));
    svg.append(...names.map((name) => this.layers[name] as SVGPathElement), this.corners, this.labels, this.place);
    this.listen();
  }

  /** This function draws a scene. */
  draw(scene: Scene): void {
    this.scene = scene;
    const size = SIZE[scene.projection];
    this.svg.setAttribute("viewBox", `0 0 ${String(size.width)} ${String(size.height)}`);
    this.svg.dataset["projection"] = scene.projection;
    const [lon, lat] = clampCenter(scene.projection, scene.zoom, scene.center);
    this.projection =
      scene.projection === "globe"
        ? geoOrthographic().rotate([-lon, -lat]).translate([size.width / 2, size.height / 2]).scale((size.width / 2 - 8) * scene.zoom).clipAngle(90).precision(0.3)
        : geoEquirectangular().rotate([-lon, 0]).center([0, lat]).translate([size.width / 2, size.height / 2]).scale((size.width / (2 * Math.PI)) * scene.zoom).precision(0.3);
    const path = geoPath(this.projection);
    const set = (name: string, object: GeoPermissibleObjects | undefined): void => {
      this.layers[name]?.setAttribute("d", object === undefined ? "" : (path(object) ?? ""));
    };
    const { result } = scene;
    set("sphere", { type: "Sphere" });
    set("graticule", geoGraticule10());
    set("equator", { type: "LineString", coordinates: densify([[-180, 0], [0, 0], [180, 0]], 2) });
    set("antimeridian", { type: "LineString", coordinates: densify([[180, -90], [180, 90]], 2) });
    set("neighbors", { type: "MultiPolygon", coordinates: result.neighbors.map((cell) => [boxRing(cell)]) });
    set("cell", shape(boxRing(result.cell)));
    set("box", result.box === undefined ? undefined : { type: "LineString", coordinates: boxRing(result.box) });
    set("area", scene.ring === undefined ? undefined : areaShape(scene.ring));
    set("buffer", result.bufferKm > 0 ? shape(bufferRing(scene.place, result.bufferKm)) : undefined);
    set("draft", scene.draft.length > 1 ? { type: "LineString", coordinates: densify(scene.draft) } : undefined);
    this.svg.dataset["location"] = result.location;
    this.drawCorners(scene.draft);
    this.drawLabels(scene);
    const at = this.visible(scene.place.lon, scene.place.lat);
    this.place.style.display = at === undefined ? "none" : "";
    if (at !== undefined) this.place.setAttribute("transform", `translate(${at[0].toFixed(1)} ${at[1].toFixed(1)})`);
  }

  /** This function gives the point on the screen of a position, or `undefined` on the far side of the globe. */
  private visible(lon: number, lat: number): [number, number] | undefined {
    const center = this.projection.rotate();
    if (this.scene?.projection === "globe") {
      const toRadians = Math.PI / 180;
      const [x, y] = [-(center[0] as number) * toRadians, -(center[1] as number) * toRadians];
      const cos = Math.sin(y) * Math.sin(lat * toRadians) + Math.cos(y) * Math.cos(lat * toRadians) * Math.cos(lon * toRadians - x);
      if (cos < 0) return undefined;
    }
    const point = this.projection([lon, lat]);
    return point === null ? undefined : [point[0], point[1]];
  }

  private drawCorners(draft: readonly Position[]): void {
    this.corners.replaceChildren(
      ...draft.flatMap(([lon, lat], index) => {
        const at = this.visible(lon, lat);
        return at === undefined ? [] : [element("circle", { class: index === 0 ? "corner first" : "corner", cx: at[0].toFixed(1), cy: at[1].toFixed(1), r: index === 0 ? "7" : "4.5" })];
      }),
    );
  }

  private drawLabels(scene: Scene): void {
    const marks: [string, number, number][] = [
      ["180°", 180, scene.projection === "globe" ? Math.max(-60, Math.min(60, scene.center[1])) + 8 : -84],
      ["North Pole", 0, 90],
      ["South Pole", 0, -90],
    ];
    this.labels.replaceChildren(
      ...marks.flatMap(([text, lon, lat]) => {
        const at = this.visible(lon, lat);
        if (at === undefined) return [];
        const label = element("text", { x: (at[0] + 6).toFixed(1), y: (at[1] - 6).toFixed(1) });
        label.textContent = text;
        return [label];
      }),
    );
  }

  /** This function gives the position of a pointer event, or `undefined` off the map. */
  private pointAt(event: { clientX: number; clientY: number }): LatLon | undefined {
    const box = this.svg.getBoundingClientRect();
    const view = this.svg.viewBox.baseVal;
    if (box.width === 0 || view.width === 0) return undefined;
    const x = ((event.clientX - box.left) * view.width) / box.width;
    const y = ((event.clientY - box.top) * view.height) / box.height;
    if (this.scene?.projection === "globe") {
      const [cx, cy] = this.projection.translate();
      if (Math.hypot(x - cx, y - cy) > this.projection.scale()) return undefined;
    }
    const inverse = this.projection.invert?.([x, y]);
    if (inverse === null || inverse === undefined || !Number.isFinite(inverse[0]) || !Number.isFinite(inverse[1])) return undefined;
    if (Math.abs(inverse[1]) > 90) return undefined;
    return { lat: inverse[1], lon: inverse[0] };
  }

  private listen(): void {
    let start: { x: number; y: number; center: readonly [number, number] } | undefined;
    let mode: "place" | "turn" | undefined;
    let dragged = false;
    this.svg.addEventListener("pointerdown", (event) => {
      if (this.scene === undefined || event.button !== 0) return;
      start = { x: event.clientX, y: event.clientY, center: this.scene.center };
      mode = (event.target as Element).closest(".place-mark") === null ? "turn" : "place";
      dragged = false;
      this.svg.setPointerCapture(event.pointerId);
    });
    this.svg.addEventListener("pointermove", (event) => {
      if (start === undefined || this.scene === undefined) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!dragged && Math.hypot(dx, dy) < DRAG_PX) return;
      dragged = true;
      this.svg.classList.add("dragging");
      if (mode === "place") {
        const point = this.pointAt(event);
        if (point !== undefined) this.events.place(point);
        return;
      }
      const box = this.svg.getBoundingClientRect();
      const degreesPerPixel = (this.scene.projection === "globe" ? 180 : 360) / box.width / this.scene.zoom;
      const lon = start.center[0] - dx * degreesPerPixel;
      this.events.turn(clampCenter(this.scene.projection, this.scene.zoom, [lon, start.center[1] + dy * degreesPerPixel]));
    });
    const end = (): void => {
      start = undefined;
      this.svg.classList.remove("dragging");
    };
    this.svg.addEventListener("pointerup", end);
    this.svg.addEventListener("pointercancel", end);
    this.svg.addEventListener("click", (event) => {
      if (dragged) {
        dragged = false;
        return;
      }
      if ((event.target as Element).closest(".corner.first") !== null) {
        this.events.close();
        return;
      }
      const point = this.pointAt(event);
      if (point !== undefined) this.events.tap(point);
    });
    this.svg.addEventListener("keydown", (event) => {
      if (this.scene === undefined) return;
      const steps: Record<string, readonly [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
      const step = steps[event.key];
      if (step === undefined) return;
      event.preventDefault();
      if (event.shiftKey) {
        const { place } = this.scene;
        this.events.place({ lat: clampLat(place.lat + step[1]), lon: place.lon + step[0] });
      } else {
        const [lon, lat] = this.scene.center;
        const degrees = 10 / this.scene.zoom;
        this.events.turn(clampCenter(this.scene.projection, this.scene.zoom, [lon + degrees * step[0], lat + degrees * step[1]]));
      }
    });
  }
}
