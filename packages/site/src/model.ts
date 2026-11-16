/**
 * This module is the model of the demo: the areas, the place, and the values that geo gives for them. It has no DOM,
 * so the tests hold it.
 *
 * A ring follows GeoJSON (RFC 7946): each edge is a straight line in longitude and latitude. A longitude past 180
 * makes an edge cross the antimeridian. The drawing densifies each edge, so the globe shows the same edges as the
 * functions of geo.
 */

import {
  type BBox,
  bboxOfGeoJson,
  decodeGeohash,
  densify as densifyEdges,
  destinationKm,
  distanceToGeometryKm,
  geohash,
  type GeohashCell,
  geohashNeighbors,
  type LatLon,
  latLon,
  locatePoint,
  type PointLocation,
  type Polygon,
  type Position,
  rewind,
} from "@mark1russell7/geo";

/** An area of the demo, with the place and the view that show it best. */
export interface Preset {
  readonly id: string;
  readonly name: string;
  /** The text under the map when the visitor picks the area. */
  readonly note: string;
  readonly ring: readonly Position[];
  readonly place: LatLon;
  /** The longitude and the latitude at the center of the view. */
  readonly view: readonly [lon: number, lat: number];
  /** The zoom of the first view of the area: 1 shows the full globe. */
  readonly zoom: number;
}

/** The ring of the Pacific area, with its longitudes past 180 written as `east`. */
function pacific(east: (lon: number) => number): Position[] {
  return [
    [168, -24],
    [east(186), -26],
    [east(194), -16],
    [east(188), -6],
    [172, -8],
    [168, -24],
  ];
}

export const PRESETS: readonly Preset[] = [
  {
    id: "antimeridian",
    name: "Across the antimeridian",
    note: "The east corners have the longitudes 186, 194 and 188. A longitude past 180 tells geo that the edge crosses the antimeridian.",
    ring: pacific((lon) => lon),
    place: { lat: -18, lon: 179.5 },
    view: [180, -18],
    zoom: 2.25,
  },
  {
    id: "long-way",
    name: "The long way round",
    note: "These are the same corners, with the longitudes -174, -166 and -172. Each edge is straight in longitude, so the area goes round the world the other way.",
    ring: pacific((lon) => lon - 360),
    place: { lat: -18, lon: 179.5 },
    view: [180, -18],
    zoom: 1,
  },
  {
    id: "pole",
    name: "Around the North Pole",
    note: "The ring goes east along 70° N, up to the pole, and back. On the flat map, the pole is the top edge.",
    ring: [
      [-180, 70],
      [-90, 70],
      [0, 70],
      [90, 70],
      [180, 70],
      [180, 90],
      [-180, 90],
      [-180, 70],
    ],
    place: { lat: 78, lon: -40 },
    view: [-40, 60],
    zoom: 1.5,
  },
];

/** This function gives the preset with the id, or `undefined`. */
export function presetOf(id: string): Preset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}

/** This function gives the area of a ring as a GeoJSON Polygon, counterclockwise as RFC 7946 tells. */
export function areaOf(ring: readonly Position[]): Polygon {
  return rewind({ type: "Polygon", coordinates: [ring] });
}

/**
 * This function gives the longitude that is nearest to `previous`, from `lon` plus or minus 360. A drawn ring uses it,
 * so each edge takes the short way, also across the antimeridian.
 */
export function unwrapLon(previous: number, lon: number): number {
  return lon + 360 * Math.round((previous - lon) / 360);
}

/** The largest longitude of a ring that geo takes (`MAX_GEOMETRY_LONGITUDE`). */
export const LONGITUDE_LIMIT = 540;

/**
 * This function adds a corner to a draft ring. It gives `undefined` when the corner goes past the longitude limit of
 * geo, after the visitor goes round the world more than one time.
 */
export function addCorner(draft: readonly Position[], point: LatLon): Position[] | undefined {
  const last = draft[draft.length - 1];
  const lon = last === undefined ? point.lon : unwrapLon(last[0], point.lon);
  if (Math.abs(lon) > LONGITUDE_LIMIT) return undefined;
  return [...draft, [lon, point.lat]];
}

/** This function closes a draft ring, or gives `undefined` when it has fewer than 3 corners. */
export function closeDraft(draft: readonly Position[]): Position[] | undefined {
  const first = draft[0];
  if (first === undefined || draft.length < 3) return undefined;
  return [...draft, first];
}

/**
 * This function adds positions to each edge with `densify` of geo, so a drawing keeps the straight edges of GeoJSON.
 * No part of an edge is longer than `step` degrees. The result is a new array, which the caller can change.
 */
export function densify(ring: readonly Position[], step = 1): [number, number][] {
  const line = densifyEdges({ type: "LineString", coordinates: ring }, step);
  return line.coordinates.map(([lon, lat]): [number, number] => [lon, lat]);
}

/**
 * This function gives the ring of a box from west to east, clockwise as d3-geo draws an exterior ring. A box across the
 * antimeridian has its west more than its east.
 */
export function boxRing(box: Pick<BBox, "west" | "south" | "east" | "north">): [number, number][] {
  const east = box.east < box.west ? box.east + 360 : box.east;
  return densify([
    [box.west, box.north],
    [east, box.north],
    [east, box.south],
    [box.west, box.south],
    [box.west, box.north],
  ]);
}

/** This function gives the ring of a buffer: the positions at `radiusKm` from the place, clockwise. */
export function bufferRing(place: LatLon, radiusKm: number, steps = 96): [number, number][] {
  const ring: [number, number][] = [];
  for (let step = 0; step <= steps; step += 1) {
    const point = destinationKm(place, (360 * step) / steps, radiusKm);
    ring.push([point.lon, point.lat]);
  }
  return ring;
}

/** The values that geo gives for the place and the area. */
export interface Readout {
  readonly location: PointLocation;
  readonly distanceKm: number;
  readonly bufferKm: number;
  /** `true` when the buffer of the place meets the area. */
  readonly meets: boolean;
  readonly hash: string;
  readonly cell: GeohashCell;
  /** The cells round the cell of the place. A cell past a pole is absent. */
  readonly neighbors: readonly GeohashCell[];
  readonly box: BBox | undefined;
}

/** This function gives the readout of a place and an area. */
export function readout(place: LatLon, area: Polygon, bufferKm: number, precision: number): Readout {
  const point = latLon(place.lat, place.lon);
  const location = locatePoint(point, area);
  const distanceKm = location === "outside" ? distanceToGeometryKm(point, area) : 0;
  const hash = geohash(point, precision);
  const neighbors = Object.values(geohashNeighbors(hash))
    .filter((cell): cell is string => cell !== undefined)
    .map((cell) => decodeGeohash(cell));
  return {
    location,
    distanceKm,
    bufferKm,
    meets: distanceKm <= bufferKm,
    hash,
    cell: decodeGeohash(hash),
    neighbors,
    box: bboxOfGeoJson(area),
  };
}

/** This function gives a latitude as text, for example `18.00° S`. */
export function formatLat(lat: number): string {
  return `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? "S" : "N"}`;
}

/** This function gives a longitude as text from -180 to 180, for example `179.50° E`. */
export function formatLon(lon: number): string {
  const normal = ((((lon + 180) % 360) + 360) % 360) - 180;
  return `${Math.abs(normal).toFixed(2)}° ${normal < 0 ? "W" : "E"}`;
}

/** This function gives a distance in kilometres as text, with no decimals from 100 km. */
export function formatKm(km: number): string {
  if (km === 0) return "0 km";
  return `${km < 100 ? km.toFixed(1) : Math.round(km).toLocaleString("en-US")} km`;
}

/** This function gives the sentence of the readout in plain words. */
export function sentence(result: Readout): string {
  if (result.location === "inside") return "The place is inside the area.";
  if (result.location === "boundary") return "The place is on the edge of the area.";
  return `The place is outside the area, ${formatKm(result.distanceKm)} from its edge.`;
}

/** This function gives the sentence of the buffer in plain words. */
export function bufferSentence(result: Readout): string {
  return `A buffer of ${formatKm(result.bufferKm)} round the place ${result.meets ? "meets" : "does not meet"} the area.`;
}

const round = (value: number, digits: number): number => Number(value.toFixed(digits));

/** One line of the code view: the code, and the value that geo gives. */
export interface CodeLine {
  readonly code: string;
  readonly value: string;
}

/** This function gives the lines of the code view for a readout. */
export function codeLines(result: Readout, precision: number): CodeLine[] {
  const box = result.box;
  return [
    { code: "locatePoint(place, area)", value: JSON.stringify(result.location) },
    { code: "distanceToGeometryKm(place, area)", value: String(round(result.distanceKm, 1)) },
    { code: `geohash(place, ${String(precision)})`, value: JSON.stringify(result.hash) },
    {
      code: "bboxOfGeoJson(area)",
      value:
        box === undefined
          ? "undefined"
          : `{ west: ${String(round(box.west, 2))}, south: ${String(round(box.south, 2))}, east: ${String(round(box.east, 2))}, north: ${String(round(box.north, 2))} }`,
    },
  ];
}
