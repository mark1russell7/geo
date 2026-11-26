# @mark1russell7/geo

Places on the Earth, as plain functions. The package has points on WGS84, great-circle distances, bearings and destinations, geodesics on the WGS84 ellipsoid, and bounding boxes that can cross the antimeridian. It gives the distance from a point to a GeoJSON geometry. It gives a circle around a point and the buffer of a geometry as GeoJSON polygons. It also has point-in-polygon and overlap tests for GeoJSON on exact predicates, geohashes, and the GeoJSON types of RFC 7946. The entry `@mark1russell7/geo/projection` has map projections to a plane in metres. The entry `@mark1russell7/geo/shapefile` reads the shapes and the attributes of a shapefile from its bytes.

- The functions are pure. They read no files, no network and no clock.
- Each angle is in degrees, in and out. A point is `{ lat, lon }`, and a GeoJSON position is `[lon, lat]`.
- An incorrect input gives a `GeoError`, with a code and a path. A function does not give `NaN` or a silent value.
- The orientation, segment and ring tests use the exact predicates of [`@mark1russell7/predicates`](https://www.npmjs.com/package/@mark1russell7/predicates). So a point on an edge is on the edge, also for coordinates with many digits. A move by 360 degrees across the antimeridian has no rounding. The section [Exact results](#exact-results) tells how.

## Install

```sh
pnpm add @mark1russell7/geo
```

The package is an ES module with types. It has two dependencies, [`@mark1russell7/predicates`](https://www.npmjs.com/package/@mark1russell7/predicates) and [`@mark1russell7/optional`](https://www.npmjs.com/package/@mark1russell7/optional), and they have no dependencies.

## Example

```ts
import { circleKm, distanceKm, distanceToGeometryKm, geodesicInverse, geohash, locatePoint, parseGeometry } from "@mark1russell7/geo";

// An area as a GeoJSON Polygon. The positions are [longitude, latitude].
const area = parseGeometry({
  type: "Polygon",
  coordinates: [[[2.25, 48.81], [2.42, 48.81], [2.42, 48.91], [2.25, 48.91], [2.25, 48.81]]],
});
if (area.tag === "err") throw area.error; // a GeoError with a code and a path

const paris = { lat: 48.8566, lon: 2.3522 }; // the center of Paris
const london = { lat: 51.5074, lon: -0.1278 }; // the center of London

if (area.value.type === "Polygon") locatePoint(paris, area.value); // "inside"
distanceKm(paris, london); // 343.556... on a sphere
geodesicInverse(paris, london).meters; // 343923.120... on the WGS84 ellipsoid
distanceToGeometryKm(paris, area.value); // 0, because the area contains the point
distanceToGeometryKm(london, area.value) <= 400; // true: London is in a buffer of 400 km around the area
geohash(paris, 7); // "u09tvw0"
circleKm(paris, 50); // a Polygon of 64 vertices: the area of 50 km around Paris, for a map
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
| `intermediatePoint(from, to, part)` | The point at a part of the way along the great circle: 0 gives the start, and 1 gives the end. |
| `distanceToGeometryKm(point, geometry, radiusKm?)`, `distanceToGeometryMeters(...)` | The great-circle distance from a point to the nearest point of a GeoJSON geometry. It is 0 in a polygon. The section [The distance to a geometry](#the-distance-to-a-geometry) gives the rules. |
| `distanceBetweenGeometriesKm(a, b, radiusKm?)`, `distanceBetweenGeometriesMeters(...)` | The great-circle distance between the nearest points of two GeoJSON geometries. It is 0 when they have a common point. The section [The distance between two geometries](#the-distance-between-two-geometries) gives the rules. |

The distance and the destination use a sphere, not the ellipsoid of WGS84. Against the ellipsoid, the error of the sphere is up to approximately 0.6 % of the distance. For the ellipsoid, use the geodesic functions.

### Unit vectors

| Function | Use |
| --- | --- |
| `UnitVector` | `{ x, y, z }`: a direction from the center of the Earth, on the axes of ECEF. |
| `toUnitVector(point)` | The vector of a point, with the length 1. |
| `fromUnitVector(vector)` | The point in the direction of a vector. The vector can have each length other than 0. |

The section [A globe](#a-globe) gives the rules.

### Geodesics on the ellipsoid

| Name | What it does |
| --- | --- |
| `WGS84` | The ellipsoid of WGS84: an equatorial radius of 6,378,137 m and a flattening of 1/298.257223563. |
| `Ellipsoid` | `{ equatorialRadiusMeters, flattening }`. A flattening less than 0 gives a prolate ellipsoid. |
| `geodesicInverse(from, to, ellipsoid?)` | The length of the shortest geodesic between two points in meters, and its bearings at the two points. |
| `geodesicDirect(from, bearing, meters, ellipsoid?)` | The point at a distance along the geodesic on an initial bearing, and the bearing at that point. |

The section [Geodesics](#geodesics) gives the method and the accuracy.

### Circles

| Name | What it does |
| --- | --- |
| `circleKm(center, distance, options?, radiusKm?)`, `circleMeters(...)` | The circle around a point as a GeoJSON Polygon or MultiPolygon, for a map. The section [The shape of a circle](#the-shape-of-a-circle) gives the rules. |
| `CircleOptions` | `{ vertices? }`: the number of the vertices, an integer from 3 to `MAX_CIRCLE_VERTICES` (65,536). |
| `DEFAULT_CIRCLE_VERTICES` | The default number of the vertices: 64. |

### Buffers

| Name | What it does |
| --- | --- |
| `bufferKm(geometry, distance, options?, radiusKm?)`, `bufferMeters(...)` | The area within a distance of a geometry as a GeoJSON Polygon or MultiPolygon, for a map. The section [The buffer of a geometry](#the-buffer-of-a-geometry) gives the rules. |
| `BufferOptions` | `{ tolerance?, maxCells? }`: the tolerance of the boundary, and the limit of the cells near the boundary. |
| `DEFAULT_MAX_BUFFER_CELLS` | The default limit of the cells: 1,000,000. |

### Short edges

| Function | Use |
| --- | --- |
| `densify(geometry, maxStep)` | A copy of a geometry with more positions on its edges. No part of an edge is longer than `maxStep` degrees. The section [A globe](#a-globe) gives the rules. |
| `MAX_DENSIFY_POSITIONS` | The largest number of positions that one call of `densify` adds: 1,000,000. |

### Lines

A line is a list of GeoJSON positions, for example a part of a street. The section [Lines](#lines-1) gives the rules.

| Name | What it does |
| --- | --- |
| `joinLines(lines)` | Joins lines with a common end into longer lines, for example the parts of one street. |
| `lineReference(line, options?)` | Puts a line on a plane in metres one time, for many queries. It gives `lengthMeters`, `nearest(point)` and `pointAt(alongMeters, offsetMeters?)`. |
| `nearestOnLine(line, point, options?)` | The nearest point of a line to a point, the distance to it, the distance along the line, and the side. |
| `lengthNearLines(line, others, withinMeters, options?)` | The length of the parts of a line within a distance of other lines, and the parts as distances along the line. For example, the frontage of a parcel along the roads. The measure is exact on the plane, with no sampling. |
| `pointAlongLine(line, alongMeters, offsetMeters?, options?)` | The point at a distance along a line, moved by an offset to the left (positive) or to the right (negative). |
| `LineOptions` | The `projection` of the plane. The default is `azimuthalEquidistant` at the first position of the line. |
| `NearestOnLine`, `LineSide`, `LineReference` | The result of `nearest`, the side (1 left, -1 right, 0 on the line), and the result of `lineReference`. |
| `LengthNearLines`, `LinePart` | The result of `lengthNearLines` (`meters`, `lengthMeters`, `parts`), and a part of a line from `fromMeters` to `toMeters`. |

### Roads

A road graph comes from GeoJSON lines, for example the ways of OpenStreetMap. You can search a route on it on your computer, with no network. The section [Roads](#roads-1) gives the rules.

| Name | What it does |
| --- | --- |
| `roadGraph(features, { mode, tags?, vertexKey? })` | The nodes and the directed edges of a travel mode. Each edge has `from`, `to`, `weight`, `meters`, `line`, `feature` and `segment`. |
| `wayAccess(tags, mode)` | The directions of one way for a travel mode: `closed`, `both`, `forward` or `backward`. |
| `WALK`, `DRIVE`, `TRAVEL_MODES` | The tables of the travel modes: the `highway` values, the access tags, the closed values and the oneway tags. |
| `ONEWAY_FORWARD`, `ONEWAY_BACKWARD` | The values of a oneway tag for each direction. |
| `nearestNode(graph, point)` | The nearest node of the graph to a point, and the distance in metres. |
| `snapToRoad(graph, point, { toleranceMeters?, id? })` | The nearest node, or a new node at the nearest point of an edge. A new node cuts the edge, and the result has a new graph. |
| `routeLine(graph, edges)` | The GeoJSON `LineString` of a route from the indices of its edges, and its length in metres. |
| `routeSteps(graph, edges, { features?, tags?, nameOf?, minLegMeters? })` | The steps of a route for a route on paper: a leg for each road with its turn and length, and then the arrival. |
| `TURN_DEGREES` | The limits of the turns in degrees: straight below 20, slight below 60, normal below 120, sharp below 170. A larger change is a U-turn. |
| `TravelMode`, `ImpliedOneway`, `WayAccess`, `RoadGraph`, `RoadNode`, `RoadEdge`, `RoadGraphOptions`, `NearestNode`, `RoadSnap`, `SnapOptions`, `RouteLine`, `RouteStep`, `RouteStepsOptions`, `RouteTurn`, `TurnDegrees` | The types of the tables, the graph and the results. |

The edges have the shape of a shortest-path search on directed edges, for example `shortestPath` of `@mark1russell7/collections/graph`. This package does not import that search.

```ts
import { roadGraph, routeLine, routeSteps, snapToRoad, type Feature } from "@mark1russell7/geo";
import { shortestPath } from "@mark1russell7/collections/graph";

// The features of the ways, for example from OpenStreetMap, fetched before.
declare const ways: Feature[];
const graph = roadGraph(ways, { mode: "walk" });
const start = snapToRoad(graph, { lat: 0.0002, lon: 0.0005 })!;
const end = snapToRoad(start.graph, { lat: 0.0011, lon: 0.0019 })!;
const path = shortestPath(end.graph.edges, start.node.id, end.node.id);
if (path.kind === "path" && path.edges.length > 0) {
  console.log(routeLine(end.graph, path.edges).meters);
  for (const step of routeSteps(end.graph, path.edges, { features: ways })) {
    console.log(step.turn, step.name || "unnamed road", Math.round(step.meters));
  }
}
```

### Bounding boxes

| Name | What it does |
| --- | --- |
| `BBox` | `{ west, south, east, north }` in degrees. When `west` is more than `east`, the box crosses the antimeridian. |
| `bboxOfPoints(points)` | The smallest box of the points, or `undefined` for no point. |
| `bboxOfGeoJson(geojson)` | The smallest box of a GeoJSON object, from its coordinates. |
| `bboxContains(box, point)`, `bboxIntersects(a, b)` | Tests on the closed area of a box. |
| `bboxCenter(box)` | The middle of a box, also across the antimeridian. The closed box has it. It is a place for a label. |
| `toGeoJsonBBox(box)`, `fromGeoJsonBBox(numbers)` | Change a box to the member `bbox` of GeoJSON, and back. `fromGeoJsonBBox` gives longitudes from -180 to 180. |

### Polygons

| Name | What it does |
| --- | --- |
| `locatePoint(point, polygon)` | Gives `"inside"`, `"boundary"` or `"outside"` for a Polygon or a MultiPolygon. The polygon contains the point when the result is not `"outside"`. |
| `pointLocator(polygon)` | Examines a polygon one time, and gives a function that locates each point with the result of `locatePoint`. Use it for many points. |
| `polygonsIntersect(a, b)` | Gives `true` when two polygons have a common point. |
| `polygonIntersectsBBox(polygon, box)` | Gives `true` when a polygon and a box have a common point. |
| `areaSquareMeters(polygon, ellipsoid?)` | Gives the area of a Polygon or a MultiPolygon on the ellipsoid, in square metres. The default ellipsoid is `WGS84`. |
| `overlapAreaSquareMeters(a, b, ellipsoid?)` | Gives the area of the overlap of two polygons on the ellipsoid, in square metres. Use it for the part of a parcel in a flood zone. |
| `commonAreaSquareMeters(polygons, ellipsoid?)` | Gives the area of the part that all the polygons have in common. With two overlaps and one common area of three polygons, you get the part of a parcel in a flood zone or a wetland. |
| `ringWinding(ring)` | Gives `"counterclockwise"`, `"clockwise"` or `"degenerate"`, from the exact sign of the area. |
| `followsRightHandRule(polygon)`, `rewind(polygon)` | Examine the right-hand rule of RFC 7946, and give a copy that follows it. |
| `MAX_GEOMETRY_LONGITUDE` | The largest absolute longitude of a polygon in a test: 540. |

### Simplification of regions

| Name | What it does |
| --- | --- |
| `simplifyRegions(regions, toleranceKm, radiusKm?)` | Simplifies Polygons and MultiPolygons that share borders, for a map. Shared borders stay shared, so no gap and no overlap opens. |
| `regionSimplifier(regions, radiusKm?)` | Prepares the shared borders one time, and gives a function that simplifies the regions for a tolerance. Use it for many zoom levels. |
| `simplifyRegionsSteps(regions, toleranceKm, radiusKm?)` | Gives the steps of `simplifyRegions` as a generator, with the same result. Each step does approximately `SIMPLIFY_STEP_WORK` of work. A server gives its event loop a turn between two steps. |
| `Region` | A `Polygon` or a `MultiPolygon`. |

### Projections

The entry `@mark1russell7/geo/projection` has the map projections. A projection changes a point to a point on a plane in metres, with x to the east and y to the north.

| Name | What it does |
| --- | --- |
| `WEB_MERCATOR` | The projection of web maps (EPSG:3857), on the plane of the tiles of OpenStreetMap. |
| `azimuthalEquidistant(center, ellipsoid?)` | A projection for the area around a center. The distance and the bearing from the center to each point are exact. |
| `Projection` | `toPlane(point)`, `fromPlane(point)`, `scale(point)` and the `name` for a legend. |
| `PlanePoint` | A point `{ x, y }` on the plane, in metres. |
| `ProjectionScale` | The largest and the smallest scale factors at a point. |
| `WEB_MERCATOR_MAX_LATITUDE`, `WEB_MERCATOR_MAX_METERS` | The limits of Web Mercator: approximately 85.0511 degrees and 20037508.34 m. |
| `transverseMercator(definition)` | The Transverse Mercator of a definition as data: the origin, the central meridian, the scale factor and the false values. |
| `lambertConformalConic(definition)` | The Lambert Conformal Conic with two standard parallels (EPSG method 9802) of a definition as data. |
| `conformalProjection(definition)` | The projection of a `ConformalDefinition`: one of the two kinds above. |
| `GRS80` | The ellipsoid of GRS 1980 and NAD83. It is the default ellipsoid of the two conformal projections. |
| `STATE_PLANE_ZONES`, `statePlaneZone(fips)` | The zones of the State Plane Coordinate System of 1983 as data, and the zone of a FIPS zone code. The list has New York, Vermont, New Hampshire and Maine. |
| `statePlaneProjection(zone)` | The projection of a zone, with its plane in metres. |
| `fromStatePlane(zone, point, unit?)`, `toStatePlane(zone, point, unit?)` | Change a point of a zone plane to NAD83, and back. The unit is `meter`, `us-survey-foot` or `international-foot`. |
| `PLANE_UNIT_METERS` | The length of each `PlaneUnit` in metres. A US survey foot is 1200/3937 m. |
| `TransverseMercatorDefinition`, `LambertConformalConicDefinition`, `ConformalDefinition`, `StatePlaneZone`, `PlaneUnit` | The types of the definitions, the zones and the units. |

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

### The sun

| Name | What it does |
| --- | --- |
| `sunPosition(at)` | Gives the declination, the right ascension and the equation of time of the sun at an instant in milliseconds. |
| `sunDay(point, date, options?)` | Gives the sunrise, the solar noon, the sunset and the hours of day at a point on a date `YYYY-MM-DD`. It gives a polar day or a polar night when the sun does not reach the altitude. |
| `SUNRISE_ALTITUDE_DEG` | The altitude of the center of the sun at sunrise and sunset, -0.833 degree: the refraction and the semidiameter. The option `altitudeDeg` gives another altitude, for example -6 for civil twilight. |

- The place of the sun comes from the low-precision formulas of The Astronomical Almanac, as the Wikipedia page "Position of the Sun" gives them. The precision is approximately 0.01 degree from 1950 to 2050.
- The sunrise and the sunset come from the hour angle of the page "Sunrise equation". The method takes the declination and the equation of time at the instant of each event.
- The refraction changes with the air, so a real sunrise can differ by approximately 2 minutes. The functions do not correct for the height of the observer.
- The date is the date of the mean solar time of the point. Its solar noon is near 12:00 UTC minus the longitude at 15 degrees for each hour.

## The rules

### Edges

RFC 7946 (section 3.1) says that an edge is a straight line in longitude and latitude. The package uses this rule. So the polygon tests use the plane of longitude and latitude, and an edge is not a great circle.

- A polygon is a closed set. A point on an edge or on a vertex is on the boundary, and `locatePoint` gives `boundary` for it. The section [The boundary](#the-boundary) tells which edges are on the boundary.
- The even-odd rule gives the inside of a ring. The first ring is the exterior, and the other rings are holes.
- A point in a hole is outside. A point on the edge of a hole is on the boundary.
- The winding of a ring does not change a result. RFC 7946 tells a parser to accept a ring that does not follow the right-hand rule, and the package accepts it.

### The boundary

- The boundary is the boundary of the written polygon. So it includes an edge that two parts of a MultiPolygon share. It also includes an edge on the cut at 180 or -180, and an edge at a pole.
- So one area can give `boundary` in one written form and `inside` in a different form. For example, a polygon cut at the antimeridian gives `boundary` on the cut, and the same polygon with longitudes past 180 gives `inside` there.
- To test if a polygon contains a point, use `locatePoint(point, polygon) !== "outside"`. This test gives the same result for each written form of an area.

### The distance to a geometry

`distanceToGeometryKm` and `distanceToGeometryMeters` give the great-circle distance from a point to the nearest point of a geometry. A test `distance <= buffer` thus tells if a place and its buffer touch an area.

- An edge of a line or of a polygon is the straight line in longitude and latitude of RFC 7946, as in the polygon tests. The distance is the distance on the sphere to the nearest point of that line.
- The distance to a polygon is 0 when `locatePoint` does not give `"outside"`. Otherwise, it is the distance to the nearest edge. The edges of the holes are edges too.
- The distance is 0 only when the point is on the geometry: in a polygon, on a line, or equal to a point. The tests of a line use the exact predicates. A point that is not on the geometry gets a distance of `Number.MIN_VALUE` or more.
- The distance to a `GeometryCollection` is the smallest distance to its members. A geometry with no position gives `Infinity`.
- A line or a polygon must have its longitudes from -540 to 540 (`MAX_GEOMETRY_LONGITUDE`). A point of the geometry can have each finite longitude.

The function divides each edge into pieces of 1 degree or less. In each piece, it finds the nearest point with a bisection on the slope of the haversine function. The property tests compare each result with a dense sample of the edge, refined by a golden-section search. No result is more than the reference by 1e-7 km or more.

### The distance between two geometries

`distanceBetweenGeometriesKm` and `distanceBetweenGeometriesMeters` give the great-circle distance between the nearest points of two geometries. A test `distance <= buffer` thus tells if an area and its buffer touch a different area.

- The distance is 0 when the geometries have a common point. Then two edges meet, or a position of one geometry is on or in the other. These tests use the exact predicates, as `polygonsIntersect` does.
- A polygon in a hole of a different polygon does not touch it. Thus its distance is more than 0.
- Otherwise, the distance is the smallest distance from a position of one geometry to the other geometry, in the two directions. A distance that is not 0 is `Number.MIN_VALUE` or more.
- A geometry with no position gives `Infinity`.
- The result does not change when `a` and `b` change places. For a `Point`, the result is equal to the result of `distanceToGeometryKm`.
- The path of an error starts with `a` or `b`, for the geometry of the error.

An edge in longitude and latitude is not a great circle. Thus the nearest points of two edges can both be inside the edges, and not at a position. A study of 1,600 pairs of edges found no such pair. This result is evidence, not a proof. In each CI run, a property test compares each result with a dense sample of two edges.

The time is in proportion to the product of the numbers of positions. A latitude bound skips the parts that are too far. For large geometries, an index of the edges is the next step.

### The shape of a circle

`circleKm` and `circleMeters` give a circle as a polygon, for example the area of an alert around a place. A point is in the circle when its great-circle distance to the center is equal to the radius or less.

- The ring has a vertex at each of `vertices` bearings from the center, at equal steps. The first vertex is to the north of the center.
- Each edge is a straight line in longitude and latitude, as in the polygon tests. More vertices give a polygon nearer to the circle.
- The result follows RFC 7946. Each longitude is from -180 to 180. The exterior ring goes counterclockwise, and a hole goes clockwise.
- A circle across the antimeridian is a `MultiPolygon` of two parts. The cut is at 180 and at -180 (RFC 7946, section 3.1.9). So `locatePoint` gives `boundary` for a point on the cut.
- A circle around one pole is a `Polygon` from -180 to 180, with an edge along the pole. So `locatePoint` gives `boundary` for that pole.
- A circle around the two poles is the Earth less the opposite circle, as one `Polygon`. The opposite circle has its center at the antipode.
- A radius of half the circumference of the sphere or more gives the whole Earth, from -180 to 180 and from -90 to 90.
- A vertex at a pole becomes an edge along the pole. So a pole on the circle is on the boundary of the result.

For a small circle away from the poles, an edge goes into the circle by at most `1 - cos(180° / vertices)` of the radius. For 64 vertices, that is 0.12 %.

### The buffer of a geometry

`bufferKm` and `bufferMeters` give the area within a distance of a geometry as a polygon. An example is the area of an alert along a storm track. The distance is the distance of `distanceToGeometryKm`. Thus the buffer of a polygon includes the polygon.

- Each point at a distance of `distance - tolerance` or less is in the result. Each point at a distance of `distance + tolerance` or more is not in the result.
- The default tolerance is the distance over 100. A tolerance is more than 0 and less than the distance.
- The result follows RFC 7946, as a circle does. Each longitude is from -180 to 180, and no edge crosses a different edge.
- A buffer across the antimeridian is cut at 180 and at -180. A buffer around a pole has an edge along the pole.
- A geometry with no position gives an empty `MultiPolygon`. A distance of half the circumference of the sphere or more gives the whole Earth.
- The buffer of a point is a circle within the tolerance. `circleKm` gives a circle with a fixed number of vertices.

A grid of cells in longitude and latitude covers the buffer. A tree of blocks finds the cells near the boundary, and the method of marching squares gives the rings. Then the method of `simplifyRegions` removes the positions that the tolerance does not need. In each CI run, a property test examines the two limits at sampled points.

The time is in proportion to the number of cells near the boundary. That number is approximately 9 times the length of the boundary over the tolerance. A buffer of 10 km with the tolerance 0.1 km around a rough coast of 5,000 km uses approximately 450,000 cells. Near a pole, the cells are narrower, so the number of cells increases. A buffer that needs more than `maxCells` cells gives the error `too-many-cells`. Then use a larger tolerance.

### Simplification of regions

`simplifyRegions` simplifies regions that share borders, for example the counties of a state, with the method of Douglas and Peucker. The result has one region for each input region, with the same type.

- Each removed position is at most `toleranceKm` from the result, as `distanceToGeometryKm` measures it. Each position of the result is a position of the input.
- Equal positions join the regions. A border that two regions share stays one border, so no gap and no overlap opens.
- A position where three or more regions meet stays in the result. A ring with no such position is one closed border.
- No edge of the result crosses another edge. No kept position goes to the other side of a border, for example an island in a bay. When a removal breaks a rule, the function keeps more positions.
- Each ring keeps 3 or more different positions, so no region and no hole goes out of the map.
- A ring with fewer than 3 different positions in the input stays as it is.
- A ring of the result starts at the first position of the input ring, when the function keeps that position.
- The tolerance 0 removes only a position on the straight line between its neighbors, and a position equal to the position before it.

The function measures each distance on the sphere, to the straight edge in longitude and latitude of RFC 7946. The tests of the crossings use exact predicates on the longitudes as written. So write all the regions in one range of longitudes. For regions across the antimeridian, use longitudes past 180, for example from 170 to 190.

A position of one region on an edge of another region does not join the two regions. So give the neighbors equal positions on their shared borders. The outlines of the US Census and of the NWS do this.

### Geodesics

`geodesicInverse` and `geodesicDirect` use the method of C. F. F. Karney, [Algorithms for geodesics](https://doi.org/10.1007/s00190-012-0578-z) (2013). The code is a port of the inverse and the direct problems of [GeographicLib](https://geographiclib.sourceforge.io/) 2.2.0 for JavaScript, by Charles Karney, with the MIT license.

- On WGS84, GeographicLib gives an error of less than 15 nm for a distance. The tests hold a limit of 1e-6 m for a distance. They hold a limit of 1e-9 degrees for a bearing or a position. The test values come from GeographicLib.
- The accuracy stays at this level for a flattening from -1/50 to 1/50. For a larger flattening, the error increases.
- The bearings are in degrees from 0 to 360 (360 not included), clockwise from north. At a pole, the bearing is measured from the meridian of the longitude of the point.
- For two equal points, the distance and the two bearings are 0.
- Two points that are almost antipodal can have more than one shortest geodesic. The function gives one of them.
- `geodesicDirect` accepts each finite distance. A negative distance goes in the opposite direction of the bearing.
- The geodesic functions compute the coefficients of each ellipsoid one time, and keep them while the ellipsoid object stays.

### Projections

- `WEB_MERCATOR` uses the formulas of a sphere with the radius 6378137 m on the coordinates of WGS84, as EPSG:3857 does. Thus it is not conformal on the ellipsoid. At the equator, its scale along a meridian is approximately 1.0067, and along the parallel it is 1.
- `WEB_MERCATOR.toPlane` refuses a latitude out of `-WEB_MERCATOR_MAX_LATITUDE` to `WEB_MERCATOR_MAX_LATITUDE` with the code `latitude-range`. It normalizes each longitude first.
- `azimuthalEquidistant` uses `geodesicInverse` and `geodesicDirect`. The distance on the plane from the center is the length of the geodesic, and the direction is its bearing. At the center, north is up.
- The scale of `azimuthalEquidistant` along a geodesic from the center is 1. Across the geodesic, it is `s / m12`, with the reduced length `m12`. At 20 km from the center, it is less than 1.000002.
- Each `fromPlane` accepts each finite point of the plane. The longitude of its result is normalized.
- A map simplifies its regions with `simplifyRegions` first, on the Earth. Then it changes each position with `toPlane`.
- `transverseMercator` uses the series of Kr�ger to the order 6 in the third flattening (Karney 2011). Within approximately 3900 km of the central meridian, the error is less than 1 mm.
- `lambertConformalConic` uses the formulas of the EPSG guidance note 7-2. Its inverse finds the latitude by iteration. The scale is 1 on each standard parallel.
- The two conformal projections give one scale factor at a point: `min` is equal to `max`.
- The tests use the worked examples of the EPSG guidance note 7-2 and of the Ordnance Survey to 1 cm or less.
- A State Plane zone uses the parameters of SPCS 83 on NAD83. In the contiguous states, NAD83 and WGS84 differ by approximately 1 to 2 m.

### Areas

An edge is a straight line in longitude and latitude, as for the polygon tests. So the area of a polygon is the area of its region of that plane on the ellipsoid.

- The theorem of Green changes the area integral into a sum over the edges. Gauss-Legendre quadrature gives the integral of each edge.
- For an edge of a parcel, the result is exact to the rounding of a double. For an edge of 40 degrees, the relative error is less than 1e-9.
- The direction of a ring does not change the area. A hole takes its area away from its exterior.
- `commonAreaSquareMeters` uses a fan of signed triangles for each ring. The common part of triangles is a convex polygon, and the signed sum of these areas is the common area. `overlapAreaSquareMeters(a, b)` is `commonAreaSquareMeters([a, b])`.
- The work is in proportion to the product of the numbers of corners of the polygons in their common box.
- The area of a union comes from inclusion and exclusion. For a parcel and two zones, add the overlap of the parcel and each zone. Then subtract the common area of the three.
- A ring must not cross itself, and each hole must be inside its exterior. The polygons of a MultiPolygon must not overlap. RFC 7946 gives these rules.
- A polygon can cross the antimeridian. A polygon moved by 360 degrees is the same area of the Earth.

### Lines

- `joinLines` joins two lines when an end of one is equal to an end of the other: the same latitude and the same normalized longitude. At a pole, each longitude is the same end.
- Each result line starts with the first input line that is not in a result yet, and keeps its direction. The function adds lines at its last end, then at its first end.
- At an end of three or more lines, the function takes the first line in the input order. The other lines go into other result lines.
- `lineReference` puts the positions on a plane one time. The default plane is `azimuthalEquidistant` at the first position. Within 20 km of that position, its scale is less than 1.000002.
- Each length is in the metres of the plane: the distance, the distance along the line, the offset and `lengthMeters`. A different `projection` gives its own metres.
- The side is for the direction from the first position to the last. A point on the line, or on the line of its nearest segment, has the side 0.
- `pointAt` gives the first or the last position for a distance out of the range from 0 to the length. At a position of the line, the offset is at right angles to the segment before it.
- A segment of length 0 has no direction, so the queries skip it. A line of length 0 gives its first position, with no offset and the side 0.
- To find the point of a house number on a street, measure the known numbers with `nearest`. Then use `pointAt` with the distance along the line and the offset of the houses.

### Roads

- `roadGraph` reads each feature with a `LineString` or a `MultiLineString`, and skips each other feature. The tags are in `properties.tags`, or else in `properties`.
- A node is a position that two or more ways share, a position that one way has two times, or an end of a way. Two lines that cross with no shared position have no junction, as at a bridge.
- The default key of a node is its latitude and its normalized longitude, with no rounding. Give `vertexKey` to use the identifiers of the OpenStreetMap nodes.
- An edge is the part of a way between two nodes. Its `meters` is the sum of `distanceMeters` along its line. Its `weight` is `meters`. Make a copy with a different weight for a time.
- A way in the two directions gives two edges with one `segment` number. A part of a way from a node back to the same node, with no other node, gives no edge.
- The order of the nodes and of the edges is the order of the input. Thus the same input gives the same graph.

`wayAccess` applies the table of the mode:

- A `highway` value that is not in `highways` closes the way. `WALK` has no motorway and no trunk road. `DRIVE` has no footway, path or steps.
- The first tag of `access` that the way has decides. A value of `denied` (`no` and `private`) closes the way. Thus `access=private` with `foot=yes` is open for `WALK`.
- The first tag of `oneway` that the way has decides the direction. `yes`, `true` and `1` give `forward`. `-1` and `reverse` give `backward`. Each other value gives `both`.
- `DRIVE` reads `oneway`. A roundabout and a motorway with no oneway tag are one-way. `WALK` reads only `oneway:foot`.
- The values are compared in lower case. Give your own `TravelMode` for a different set of rules, for example a bicycle.

`snapToRoad` measures on the plane of `azimuthalEquidistant` at the point, so each distance from the point is exact on the ellipsoid. A cut gives two edges for each direction of the part. Each new edge keeps its share of the weight. A nearest point within `toleranceMeters` (0.5 by default) of an end goes to that end.

`routeSteps` makes the steps of a route:

- Give the features of the graph in `features`. The field `feature` of each edge is an index into them. With no features, each road has an empty name.
- Consecutive edges with the same road name make one leg. The default name is the tag `name`, then the tag `ref`, then an empty name. `nameOf` gives a different name.
- A change of name makes a new leg, also on a straight road. Then the turn is `straight`. A turn on a road with one name makes no new leg.
- The turn comes from the change of the bearing from the last segment of the leg before to the first segment of the leg. `initialBearing` gives the two bearings.
- `bearingChange` is from -180 to less than 180 degrees. A negative value is a turn to the left. Use it for your own rule.
- `TURN_DEGREES` gives the turn from the absolute change. A change below 20 is `straight`, and below 60 is `slight-left` or `slight-right`.
- A change below 120 is `left` or `right`, and below 170 is `sharp-left` or `sharp-right`. A larger change is `u-turn`.
- A segment of length 0 has no direction, so the function skips it. A leg with no direction gives a change of 0.
- The first leg has the turn `depart`. The last step has the turn `arrive`, 0 metres and the index of the last edge.
- `startIndex` and `endIndex` are indices into the edge list of the route. The two limits are in the leg.
- `minLegMeters` is 0 by default, so no leg joins. A leg shorter than it joins its two neighbors when they have the same name. The first and the last legs do not join.

### Exact results

The orientation and segment tests are exact. A test across the antimeridian also moves the point or a polygon by a multiple of 360 degrees.

- The float sum of a longitude and 360 can round. For example, `-70.1 + 360` rounds.
- The tests do not use that sum. The shifted predicates of `@mark1russell7/predicates` take the longitude and the move as two inputs, and give the sign of the exact moved point.
- So `locatePoint`, `pointLocator`, `polygonsIntersect` and `polygonIntersectsBBox` are exact for each longitude. The result of `polygonsIntersect` does not change when the two polygons change places.
- The polygon tests refuse a position with a longitude out of -540 to 540 (`MAX_GEOMETRY_LONGITUDE`) with the error `longitude-range`. Each area of the Earth has a written form in that range, and the limit keeps the time of a test small.

### Many points against one polygon

`locatePoint` examines each edge of the polygon for each point. `pointLocator` makes an index of the edges one time.

- The index puts the edges of each part in bands of latitude. A point examines only the edges of its band.
- The test of each edge is `rayEdge` of `@mark1russell7/predicates`, the exact test of `locatePoint`. So the two functions give the same result for each point.
- The locator copies the positions. A later change of the polygon does not change the locator.
- The index needs approximately 40 bytes for each edge.
- A ring with many long edges in latitude, for example a star, puts many edges in each band. Then each point examines many edges.

### Rings

- A ring must have four or more positions, and its last position must be equal to its first position.
- The functions do not close a ring. An unclosed ring gives the error `ring-not-closed`.
- `ringWinding` gives `"degenerate"` for a ring with no area, and `rewind` does not change that ring.

### The antimeridian

- The longitudes -180 and 180 are the same meridian for the polygon tests and the box tests. A geohash keeps the written value (refer to [Geohashes](#geohashes)).
- A box with `west` more than `east` crosses the antimeridian. The box of RFC 7946 (section 5.2) for the Fiji islands is `[177, -20, -178, -16]`.
- An edge from 170 to -170 goes through 0, because an edge is straight in longitude. To cross the antimeridian, cut the geometry there (RFC 7946, section 3.1.9), or use longitudes past 180, for example from 170 to 190.
- `bboxOfPoints` and `bboxOfGeoJson` take the narrower box. When the two boxes have the same width, they take the box that does not cross.
- A GeoJSON `bbox` accepts each finite longitude, as a position does. So a box can be in the frame of its coordinates, for example `[170, -20, 190, -16]`.
- `fromGeoJsonBBox` gives the same box with longitudes from -180 to 180, with no rounding. A box with its two longitudes from -180 to 180 does not change.
- A box with `east - west` of 360 or more has the full range, from -180 to 180. For each other box, the function normalizes the west and the east.
- In that normalization, an east that is 180 plus a multiple of 360 becomes 180, not -180. So `[170, 190]` gives `[170, -170]`, and `[190, 540]` gives `[-170, 180]`.
- If the west of that box is also on the antimeridian, the box is only the antimeridian. For example, `[540, 540]` gives `[-180, -180]`.

### Poles

- All the longitudes of latitude 90 (or -90) are one point.
- A pole is on the boundary of a polygon when a ring has a position at that pole. Otherwise, the pole is outside.
- A box that reaches a pole contains the pole at each longitude. A box around a pole has the longitudes from -180 to 180 (RFC 7946, section 5.3).
- `geohashNeighbor` gives `undefined` past a pole.

### A globe

A globe shows a point as a vector from the center of the Earth. An edge of GeoJSON is not a great circle, so a globe needs short edges.

- The axes of a `UnitVector` are the axes of ECEF. `x` points to latitude 0 and longitude 0. `y` points to latitude 0 and longitude 90 east. `z` points to the north pole.
- All the longitudes of a pole give one vector. A vector along the axis of the poles gives the longitude 0.
- `intermediatePoint` follows the great circle. A part of less than 0 gives a point before the start, on the same great circle. A part of more than 1 gives a point after the end.
- Two opposite points have many great circles. For them, `intermediatePoint` uses the great circle of `initialBearing`.
- `densify` follows the edge of RFC 7946, a straight line in longitude and latitude. It does not follow the great circle. So an edge from 170 to -170 gets positions through 0.
- `densify` divides each edge into equal parts. The number of the parts is the smallest that makes each part `maxStep` degrees or less, in longitude and in latitude.
- The positions of the geometry stay, in the same sequence. So the geometry has the same points and the same box.
- An edge gives the same new positions in the two directions. So two polygons with a common border stay together.
- A new position has an altitude only when the two ends of its edge have one. A `Point` and a `MultiPoint` do not change.
- `densify` refuses a step that adds more than `MAX_DENSIFY_POSITIONS` positions, with the error `step`.
- To draw a polygon on a globe, use `densify` first. Then use `toUnitVector` for each position.

### Geohashes

- A point on an edge between two cells goes to the cell on the north or on the east.
- A longitude from -180 to 180 does not change. The longitude 180 goes to the last cell on the east, and -180 goes to the first cell on the west. A longitude out of that range is normalized first, so 540 goes to the cell of -180.
- `geohashesInBBox` uses the same rule for the edges of a box. So the box from 170 to 180 gives the last column only, and the box from 170 to -180 also gives the first column.
- `geohashesInBBox` gives each cell that has a point of the box, one time. A cell that touches the box only on the south edge or the west edge of the box is not in the list.
- `geohashesInBBox` refuses a cover of more than `maxCells` cells (10,000 is the default) with the error `too-many-cells`. A `maxCells` that is `NaN` or less than 0 gives the error `max-cells`.

## The errors

Each `GeoError` has a `code` and a `path`. The path shows the position of the fault in a GeoJSON object, for example `features[0].geometry.coordinates[1]`.

| Code | The cause |
| --- | --- |
| `not-finite` | A number is `NaN` or infinite. |
| `latitude-range`, `longitude-range` | A latitude is out of -90 to 90 or out of the range of a projection, a longitude of a `BBox` is out of -180 to 180, or a longitude of a polygon in a test is out of -540 to 540. A GeoJSON `bbox` and `parseGeoJson` accept each finite longitude. |
| `not-a-point` | A value is not an object with the numbers `lat` and `lon`. |
| `geojson-type`, `geojson-member` | A GeoJSON object has an unknown type, or a member is missing or incorrect. |
| `position`, `too-few-positions`, `ring-not-closed` | A position, a line or a ring is incorrect. |
| `too-deep` | The collections are nested more than `MAX_GEOJSON_DEPTH` levels. |
| `bbox` | The south of a box is more than its north, a GeoJSON `bbox` does not have 4 or 6 numbers, or its low altitude is more than its high altitude. |
| `geohash-precision`, `geohash-length`, `geohash-character` | A precision, the length of a geohash or a character of a geohash is incorrect. |
| `too-many-cells` | A cover of a box or a buffer needs more cells than `maxCells`. |
| `max-cells` | The value of `maxCells` is `NaN` or less than 0, or less than 1 for a buffer. |
| `radius` | The radius of the sphere or of a circle, or the distance of a buffer, is not more than 0. Or the equatorial radius of an ellipsoid is not more than 0, or its polar radius is not a finite number more than 0. |
| `vertices` | The number of the vertices of a circle is not an integer from 3 to `MAX_CIRCLE_VERTICES`. |
| `tolerance` | The tolerance of a simplification is less than 0. Or the tolerance of a buffer is 0 or less, or it is equal to the distance or more. Or `minLegMeters` of `routeSteps` is not a finite number from 0. |
| `vector` | A vector has the length 0, so it has no direction. |
| `step` | The largest step of `densify` is not more than 0. Or the step is too small, and the function adds more than `MAX_DENSIFY_POSITIONS` positions. |
| `travel-mode` | A travel mode is not a name of `TRAVEL_MODES`, or its table is incorrect. |
| `route` | A route has no edges, an index that is not an edge of the graph, or two edges that do not join. |
| `date` | A date is not a date `YYYY-MM-DD`. |
| `altitude` | The altitude of the sun is not a finite number from -90 to 90. |
| `projection` | A projection definition is not correct, for example a scale factor that is not more than 0. Or a point has no finite point on the plane. |

## The differences from @procedures/geo

[`@procedures/geo`](https://www.npmjs.com/package/@procedures/geo) has `greatCircleKm` and a geohash, and this package is their home. The results are the same, except for these changes:

- The default radius is 6371.0088 km, not 6371 km. `distanceKm(a, b, 6371)` gives the value of `greatCircleKm(a, b)`.
- `geohash` normalizes a longitude out of -180 to 180. `@procedures/geo` refuses it.
- An incorrect input gives a `GeoError`. It is a `RangeError`, as before.

The geohash tests use the vectors of `@procedures/geo`, of [geohash.org](http://geohash.org/u4pruydqqvj) and of the npm package [ngeohash](https://www.npmjs.com/package/ngeohash).

## License

MIT

The geodesic functions are a port of [GeographicLib](https://geographiclib.sourceforge.io/) for JavaScript, Copyright (c) 2011-2022, Charles Karney, with the MIT license. The file `src/geodesic.ts` keeps its notice.
