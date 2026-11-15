# @mark1russell7/geo

Places on the Earth, as plain functions. The package has points on WGS84, great-circle distances, bearings and destinations, and bounding boxes that can cross the antimeridian. It also has exact point-in-polygon and overlap tests for GeoJSON, geohashes, and the GeoJSON types of RFC 7946.

- The functions are pure. They read no files, no network and no clock.
- Each angle is in degrees, in and out. A point is `{ lat, lon }`, and a GeoJSON position is `[lon, lat]`.
- An incorrect input gives a `GeoError`, with a code and a path. A function does not give `NaN` or a silent value.
- The orientation and segment tests use the exact predicates of [`@mark1russell7/predicates`](https://www.npmjs.com/package/@mark1russell7/predicates). So a point on an edge is on the edge, also for coordinates with many digits.

## Install

```sh
pnpm add @mark1russell7/geo
```

The package is an ES module with types. It has two dependencies, [`@mark1russell7/predicates`](https://www.npmjs.com/package/@mark1russell7/predicates) and [`@mark1russell7/optional`](https://www.npmjs.com/package/@mark1russell7/optional), and they have no dependencies.

## Example

```ts
import { distanceKm, geohash, parseGeometry, pointInPolygon } from "@mark1russell7/geo";

// An area as a GeoJSON Polygon. The positions are [longitude, latitude].
const area = parseGeometry({
  type: "Polygon",
  coordinates: [[[2.25, 48.81], [2.42, 48.81], [2.42, 48.91], [2.25, 48.91], [2.25, 48.81]]],
});
if (area.tag === "err") throw area.error; // a GeoError with a code and a path

const paris = { lat: 48.8566, lon: 2.3522 }; // the center of Paris
const london = { lat: 51.5074, lon: -0.1278 }; // the center of London

if (area.value.type === "Polygon") pointInPolygon(paris, area.value); // true
distanceKm(paris, london); // 343.556...
geohash(paris, 7); // "u09tvw0"
```

`parseGeometry` and `parseGeoJson` give a `Result` of [`@mark1russell7/optional`](https://www.npmjs.com/package/@mark1russell7/optional). The other functions give the value, or they throw a `GeoError`. A `GeoError` is a `RangeError`.

## The functions

### Points

| Name | What it does |
| --- | --- |
| `latLon(lat, lon)` | Makes a point. It refuses a value that is not finite and a latitude out of -90 to 90, and it normalizes the longitude. |
| `parseLatLon(value)` | Reads an unknown value as a point, and gives a `Result`. |
| `normalizeLon(lon)` | Gives the same longitude in the range from -180 to 180 (180 not included). |
| `toPosition(point)`, `fromPosition(position)` | Change a point to a GeoJSON position `[lon, lat]`, and back. |

### Distance, bearing and destination

| Name | What it does |
| --- | --- |
| `EARTH_MEAN_RADIUS_KM`, `EARTH_MEAN_RADIUS_METERS` | The mean radius of the Earth of the IUGG, 6371.0088 km. |
| `distanceKm(a, b, radiusKm?)`, `distanceMeters(a, b, radiusMeters?)` | The great-circle distance on a sphere, with the haversine formula. |
| `centralAngleRadians(a, b)` | The angle between two points at the center of the sphere. |
| `initialBearing(from, to)` | The bearing at the start of the great circle, from 0 to 360 (360 not included), clockwise from north. |
| `destinationKm(from, bearing, distance, radiusKm?)`, `destinationMeters(...)` | The point at a distance from a point, on an initial bearing. |

The distance and the destination use a sphere, not the ellipsoid of WGS84. Against the ellipsoid, the error of the sphere is up to approximately 0.5 % of the distance.

### Bounding boxes

| Name | What it does |
| --- | --- |
| `BBox` | `{ west, south, east, north }` in degrees. When `west` is more than `east`, the box crosses the antimeridian. |
| `bboxOfPoints(points)` | The smallest box of the points, or `undefined` for no point. |
| `bboxOfGeoJson(geojson)` | The smallest box of a GeoJSON object, from its coordinates. |
| `bboxContains(box, point)`, `bboxIntersects(a, b)` | Tests on the closed area of a box. |
| `toGeoJsonBBox(box)`, `fromGeoJsonBBox(numbers)` | Change a box to the member `bbox` of GeoJSON, and back. |

### Polygons

| Name | What it does |
| --- | --- |
| `locatePoint(point, polygon)` | Gives `"inside"`, `"boundary"` or `"outside"` for a Polygon or a MultiPolygon. |
| `pointInPolygon(point, polygon)` | Gives `true` when the point is inside or on the boundary. |
| `polygonsIntersect(a, b)` | Gives `true` when two polygons have a common point. |
| `polygonIntersectsBBox(polygon, box)` | Gives `true` when a polygon and a box have a common point. |
| `ringWinding(ring)` | Gives `"counterclockwise"`, `"clockwise"` or `"degenerate"`, from the exact sign of the area. |
| `followsRightHandRule(polygon)`, `rewind(polygon)` | Examine the right-hand rule of RFC 7946, and give a copy that follows it. |

### Geohashes

| Name | What it does |
| --- | --- |
| `geohash(point, precision?)` | The geohash of a point, with 1 to 12 characters (7 is the default). |
| `decodeGeohash(hash)` | The cell of a geohash: its edges and its center. Upper case letters are accepted. |
| `geohashNeighbor(hash, direction)`, `geohashNeighbors(hash)` | The cell next to a cell in a direction, or `undefined` past a pole. |
| `geohashesInBBox(box, precision, maxCells?)` | The cells that cover a box, from south to north and then from west to east. |

### GeoJSON

| Name | What it does |
| --- | --- |
| `parseGeoJson(value)`, `parseGeometry(value)` | Examine an unknown value against RFC 7946, and give a typed `Result`. |
| `Point`, `MultiPoint`, `LineString`, `MultiLineString`, `Polygon`, `MultiPolygon`, `GeometryCollection` | The geometry types. |
| `Feature`, `FeatureCollection`, `GeoJson`, `GeoJsonBBox` | The other types of RFC 7946. |
| `MAX_GEOJSON_DEPTH` | The most levels of nested collections that the parser accepts (32). |

## The rules

### Edges

RFC 7946 (section 3.1) says that an edge is a straight line in longitude and latitude. The package uses this rule. So the polygon tests are exact on the plane of longitude and latitude, and an edge is not a great circle.

- A polygon is a closed set. A point on an edge or on a vertex is on the boundary, and `pointInPolygon` gives `true` for it.
- The even-odd rule gives the inside of a ring. The first ring is the exterior, and the other rings are holes.
- A point in a hole is outside. A point on the edge of a hole is on the boundary.
- The winding of a ring does not change a result. RFC 7946 tells a parser to accept a ring that does not follow the right-hand rule, and the package accepts it.

### Rings

- A ring must have four or more positions, and its last position must be equal to its first position.
- The functions do not close a ring. An unclosed ring gives the error `ring-not-closed`.
- `ringWinding` gives `"degenerate"` for a ring with no area, and `rewind` does not change that ring.

### The antimeridian

- The longitude -180 is the longitude 180.
- A box with `west` more than `east` crosses the antimeridian. The box of RFC 7946 (section 5.2) for the Fiji islands is `[177, -20, -178, -16]`.
- An edge from 170 to -170 goes through 0, because an edge is straight in longitude. To cross the antimeridian, cut the geometry there (RFC 7946, section 3.1.9), or use longitudes past 180, for example from 170 to 190.
- `bboxOfPoints` and `bboxOfGeoJson` take the narrower box. When the two boxes have the same width, they take the box that does not cross.

### Poles

- All the longitudes of latitude 90 (or -90) are one point.
- A pole is on the boundary of a polygon when a ring has a position at that pole. Otherwise, the pole is outside.
- A box that reaches a pole contains the pole at each longitude. A box around a pole has the longitudes from -180 to 180 (RFC 7946, section 5.3).
- `geohashNeighbor` gives `undefined` past a pole.

### Geohashes

- A point on an edge between two cells goes to the cell on the north or on the east.
- The longitude 180 goes to the last cell on the east. A longitude out of -180 to 180 is normalized first.
- `geohashesInBBox` gives each cell that has a point of the box. It refuses a cover of more than `maxCells` cells (10,000 is the default) with the error `too-many-cells`.

## The errors

Each `GeoError` has a `code` and a `path`. The path shows the position of the fault in a GeoJSON object, for example `features[0].geometry.coordinates[1]`.

| Code | The cause |
| --- | --- |
| `not-finite` | A number is `NaN` or infinite. |
| `latitude-range`, `longitude-range` | A latitude is out of -90 to 90, or the longitude of a box is out of -180 to 180. |
| `not-a-point` | A value is not an object with the numbers `lat` and `lon`. |
| `geojson-type`, `geojson-member` | A GeoJSON object has an unknown type, or a member is missing or incorrect. |
| `position`, `too-few-positions`, `ring-not-closed` | A position, a line or a ring is incorrect. |
| `too-deep` | The collections are nested more than `MAX_GEOJSON_DEPTH` levels. |
| `bbox` | The south of a box is more than its north, or a GeoJSON `bbox` does not have 4 or 6 numbers. |
| `geohash-precision`, `geohash-length`, `geohash-character` | A precision, the length of a geohash or a character of a geohash is incorrect. |
| `too-many-cells` | A cover of a box has more cells than `maxCells`. |

## The differences from @procedures/geo

[`@procedures/geo`](https://www.npmjs.com/package/@procedures/geo) has `greatCircleKm` and a geohash, and this package is their home. The results are the same, except for these changes:

- The default radius is 6371.0088 km, not 6371 km. `distanceKm(a, b, 6371)` gives the value of `greatCircleKm(a, b)`.
- `geohash` normalizes a longitude out of -180 to 180. `@procedures/geo` refuses it.
- An incorrect input gives a `GeoError`. It is a `RangeError`, as before.

The geohash tests use the vectors of `@procedures/geo`, of [geohash.org](http://geohash.org/u4pruydqqvj) and of the npm package [ngeohash](https://www.npmjs.com/package/ngeohash).

## License

MIT
