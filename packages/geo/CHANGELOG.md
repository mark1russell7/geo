# Changelog

## 0.5.9

- `routeSteps(graph, edges, options?)` gives the steps of a route for a route on paper. Each leg has `turn`, `bearingChange`, `name`, `ref`, `meters`, `startIndex` and `endIndex`. The last step is `arrive`, with 0 metres.
- Consecutive edges with the same road name make one leg. The default name is the tag `name`, then `ref`, then an empty name. `nameOf(feature, index)` gives a different name. The option `features` gives the features of the graph.
- The turn comes from the change of the bearing from the last segment of the leg before to the first segment of the leg, from `initialBearing`. `TURN_DEGREES` holds the limits: straight below 20 degrees, slight below 60, normal below 120, sharp below 170, and a U-turn from 170.
- A change of name with no real turn gives a new leg with the turn `straight`.
- `minLegMeters` (default 0, off) joins a short leg to its two neighbors when they have the same name.
- The new types are `RouteStep`, `RouteStepsOptions`, `RouteTurn` and `TurnDegrees`. The codes of `GeoErrorCode` do not change. `routeSteps` uses `route`, `tolerance` and `geojson-member`.
- PATCH: new exports before 1.0.0. The change adds a function, and it changes no function. Thus the version is a PATCH change (before 1.0.0, a new feature is a PATCH change).

## 0.5.8

- `roadGraph(features, { mode, tags?, vertexKey? })` makes a road graph from GeoJSON lines, for example the ways of OpenStreetMap. A node is a shared position or an end of a way. Each directed edge has its length in metres and its line.
- `wayAccess(tags, mode)` gives the directions of a way. The tables `WALK` and `DRIVE` hold the `highway` values, the access tags and the oneway tags. A caller can give its own `TravelMode`.
- `nearestNode(graph, point)` gives the nearest node. `snapToRoad(graph, point, options?)` gives the nearest node or cuts the nearest edge, and gives a new graph.
- `routeLine(graph, edges)` gives the GeoJSON line of a route and its length.
- The edges have `from`, `to` and `weight`, the shape of `shortestPath` of `@mark1russell7/collections/graph`. The package does not import it.
- `GeoErrorCode` gets the codes `travel-mode` and `route`.
- PATCH: new exports before 1.0.0. The change adds functions, and it changes no function. Thus the version is a PATCH change (before 1.0.0, a new feature is a PATCH change).

## 0.5.5

- `joinLines(lines)` joins lines with a common end into longer lines, for example the parts of one street. The first input line of each result keeps its direction.
- `lineReference(line, options?)` puts a line on a plane in metres one time. It gives `lengthMeters`, `nearest(point)` and `pointAt(alongMeters, offsetMeters?)`.
- `nearestOnLine(line, point, options?)` gives the nearest point of a line to a point: the distance, the distance along the line and the side (1 left, -1 right, 0 on the line). The side is exact on the plane, from `orient2dSign` of `@mark1russell7/predicates`.
- `pointAlongLine(line, alongMeters, offsetMeters?, options?)` gives the point at a distance along a line, moved by an offset to the left or to the right.
- The default plane is `azimuthalEquidistant` of the entry `/projection` at the first position of the line. `LineOptions` sets a different `projection`.
- The new types are `LineOptions`, `LineReference`, `LineSide` and `NearestOnLine`. The codes of `GeoErrorCode` do not change.
- PATCH: new exports before 1.0.0. The change adds functions, and it changes no function. Thus the version is a PATCH change (before 1.0.0, a new feature is a PATCH change).

## 0.5.4

- The new entry `@mark1russell7/geo/projection` has map projections: `WEB_MERCATOR` (EPSG:3857) and `azimuthalEquidistant(center, ellipsoid?)`, for the area around a center.
- Each `Projection` has `toPlane`, `fromPlane` and `scale`. The plane is in metres, with x to the east and y to the north. `scale` gives the largest and the smallest scale factors at a point, for a scale bar.
- The distance and the bearing from the center of `azimuthalEquidistant` are exact, from `geodesicInverse`. Its scale across a geodesic comes from the reduced length of the geodesic.
- A latitude out of the range of Web Mercator gives the code `latitude-range`. The codes of `GeoErrorCode` do not change.
- The root entry does not change.
- PATCH: a new entry before 1.0.0. The change adds functions, and it changes no function. Thus the version is a PATCH change (before 1.0.0, a new feature is a PATCH change).

## 0.5.3

- Fix: `simplifyRegions` and `regionSimplifier` give the same output as the search of each position, also near a pole. Since 0.3.2, the search of a span skips each position whose bound is less than the best angle.
- Before, the bound of a position very near a pole was able to be less than its angle. So the search was able to skip a position with an angle that was larger than the best angle.
- The fix: the bound is the larger of the box bound and the probe value of the edge. The measure of the angle uses these two values. So the bound is not less than the angle, also in floating point.
- A property test of CI found this fault with a viewer at the south pole. A new test keeps that case.
- PATCH: a bug fix with no change of the public API. Thus the version is a PATCH change.

## 0.5.2

- `bboxCenter` gives the middle of a box: the middle of its latitudes, and the middle of its arc of longitudes. For a box that crosses the antimeridian, the middle is on the arc across the antimeridian.
- The closed box has the result, also when the width of the box is one rounding step.
- The middle is a place for a label of a region, or for the first view of a map. It is not the centroid of a shape.
- PATCH: a new export before 1.0.0. This change adds one function, and it changes no function. Thus the version is a PATCH change (before 1.0.0, a new feature is a PATCH change).

## 0.5.1

- `bufferKm` and `bufferMeters` are faster, with the same guarantee. Each point at a distance of `distance - tolerance` or less is in the result. Each point at `distance + tolerance` or more is not.
- The cells are larger. The diameter of a cell is 5/8 of the tolerance or less, from the haversine formula. Before, the side of a cell was 1/4 of the tolerance.
- The search of the nearest point of an edge stops when its result is within 1/16 of the tolerance. The center of a block of cells gives its value to a corner of the grid.
- A buffer uses approximately 9 cells for each tolerance of the length of its boundary. Before, it used approximately 16. On the cases of the bench, the trigonometric operations decrease 2.1 to 2.9 times.
- The positions of a result can change. The guarantee does not change.
- PATCH: faster functions, with no change of the API. Thus the version is a PATCH change.

## 0.5.0

- `toUnitVector` gives a point as a vector with the length 1, on the axes of ECEF. `fromUnitVector` gives the point in the direction of a vector. The new type is `UnitVector`.
- `intermediatePoint` gives the point at a part of the way along the great circle between two points.
- `densify` gives a copy of a geometry with more positions on its edges. No part of an edge is longer than a step in degrees. Each new position is on the straight line in longitude and latitude of its edge.
- `MAX_DENSIFY_POSITIONS` is the limit of the new positions of one call of `densify` (1,000,000).
- These functions are for a drawing on a globe: `densify` makes the edges short, and `toUnitVector` puts each position on the sphere. The README gives the rules.
- The new error code `vector` refuses a vector with the length 0. The new error code `step` refuses a step of `densify` that is not more than 0, or that adds too many positions.
- Fix: `bboxOfGeoJson` gives the ends of each edge with no rounding. Before, the east of an edge was `west + (east - west)` in floating point. So the box of the line from 1.1 to 6.8 had the east 6.799999999999999, and it did not contain the end of the line.
- Fix: two edges with a common position give two arcs that touch. Before, a gap of one rounding step was possible between them. So the line through the longitudes -180, 0.1 and 180 got a box from 0.1 to 0.09999999999999432, not from -180 to 180.
- `GeoErrorCode` has two new values. A caller with a full `switch` on the codes must add them. Thus the version is a MINOR change (before 1.0.0, a breaking change is a MINOR change).

## 0.4.4

- `bufferKm` and `bufferMeters` give the buffer of a GeoJSON geometry. The buffer is the area within a distance of the geometry, as a GeoJSON Polygon or MultiPolygon. Each point at a distance of `distance - tolerance` or less is in the result, and each point at `distance + tolerance` or more is not. The README gives the rules.
- `BufferOptions` has the options `tolerance` and `maxCells`. `DEFAULT_MAX_BUFFER_CELLS` is the default limit of the cells (1,000,000).
- The error codes `tolerance`, `max-cells`, `too-many-cells` and `radius` also refuse incorrect options of a buffer.
- PATCH: new exports before 1.0.0. This change adds functions, and it changes no function. Thus the version is a PATCH change (before 1.0.0, a new feature is a PATCH change).

## 0.4.3

- `distanceBetweenGeometriesKm` and `distanceBetweenGeometriesMeters` give the great-circle distance between the nearest points of two GeoJSON geometries. The distance is 0 when the geometries have a common point. The README gives the rules.
- This change adds two functions, and it does not change the existing API. Before 1.0.0, a new function is a PATCH change. Thus the version is a PATCH change.

## 0.4.2

- `geodesicInverse` gives the length of the shortest geodesic between two points on an ellipsoid, and its bearings at the two points. `geodesicDirect` gives the point at a distance along a geodesic on an initial bearing.
- `WGS84` is the ellipsoid of WGS84, and the default of the two functions. The new types are `Ellipsoid`, `GeodesicInverse` and `GeodesicDirect`.
- The functions use the method of Karney (2013). The code is a port of GeographicLib 2.2.0 for JavaScript, with the MIT license. On WGS84, the tests hold a limit of 1e-6 m for a distance and 1e-9 degrees for a bearing or a position.
- The error code `radius` also refuses an ellipsoid with an equatorial radius or a polar radius that is not more than 0.
- PATCH: new exports before 1.0.0. This change adds functions, and it changes no function. Thus the version is a PATCH change (before 1.0.0, a new feature is a PATCH change).

## 0.4.1

- `pointLocator(polygon)` examines a polygon one time, and gives a function that locates each point. For each point, it gives the result of `locatePoint`.
- The locator puts the edges of each part in bands of latitude. A point examines only the edges of its band, with the exact test `rayEdge` of `@mark1russell7/predicates` 0.1.5.
- This change adds an export, and it does not change the old API. Thus the version is a PATCH change (before 1.0.0, a new feature is a PATCH change).

## 0.4.0

- `circleKm` and `circleMeters` give a circle on the Earth as a GeoJSON Polygon or MultiPolygon, for a map. A circle across the antimeridian is cut there. A circle around a pole has an edge along the pole. The README gives the rules.
- The option `vertices` sets the number of the vertices. The default is `DEFAULT_CIRCLE_VERTICES` (64), and the limit is `MAX_CIRCLE_VERTICES` (65,536).
- The new error code `vertices` refuses a number of vertices that is not an integer from 3 to `MAX_CIRCLE_VERTICES`.
- `GeoErrorCode` has a new value. A caller with a full `switch` on the codes must add it. Thus the version is a MINOR change (before 1.0.0, a breaking change is a MINOR change).

## 0.3.2

- `simplifyRegions` and `regionSimplifier` give the same output as 0.3.1, approximately 17 times faster. In CI, 552 regions with 325,000 positions take 205 to 275 ms. Version 0.3.1 takes 3.7 to 4.6 s.
- This change is a speed fix, and it does not change the public API. Thus the version is a PATCH change.

## 0.3.1

- The point-in-polygon and overlap tests move a point across the antimeridian with no rounding. They use the exact predicates of `@mark1russell7/predicates` 0.1.4. The limit of 1e-12 degrees on the exact results at the antimeridian goes.
- This change is a fix, and it does not change the public API. Thus the version is a PATCH change.

## 0.3.0

- `simplifyRegions` and `regionSimplifier` simplify Polygons and MultiPolygons that share borders, for a map. A shared border stays shared, so no gap and no overlap opens. The README gives the rules.
- The type `Region` is a `Polygon` or a `MultiPolygon`.
- The new error code `tolerance` refuses a tolerance less than 0.
- `distanceToGeometryKm` gives the same distance to an edge in each of its two directions. Before, the last digits could change with the direction.
- `GeoErrorCode` has a new value. A caller with a full `switch` on the codes must add it. Thus the version is a MINOR change (before 1.0.0, a breaking change is a MINOR change).

## 0.2.1

- `distanceToGeometryKm` and `distanceToGeometryMeters` give the great-circle distance from a point to the nearest point of a GeoJSON geometry. The distance to a polygon is 0 when `locatePoint` does not give `outside`. The distance is 0 only when the point is on the geometry. The README gives the rules.
- This change adds functions, and it changes no function. Thus the version is a PATCH change (before 1.0.0, a new feature is a PATCH change).

## 0.2.0

- The polygon tests refuse a position with a longitude out of -540 to 540, with the error `longitude-range`. Before, a polygon with a very large longitude, for example 1e12, made `locatePoint`, `polygonsIntersect` and `polygonIntersectsBBox` run for a very long time. The new constant `MAX_GEOMETRY_LONGITUDE` gives the limit.
- This change refuses an input that 0.1.0 accepted. Thus the version is a MINOR change.

## 0.1.0

The first version.

- Points on WGS84: `latLon`, `parseLatLon`, `normalizeLon`, `toPosition` and `fromPosition`.
- The great-circle distance with the mean radius of the IUGG (6371.0088 km), the initial bearing and the destination.
- Bounding boxes that can cross the antimeridian: `bboxOfPoints`, `bboxOfGeoJson`, `bboxContains` and `bboxIntersects`.
- Point-in-polygon and overlap tests for Polygon and MultiPolygon, with holes, on the straight edges of RFC 7946. They use exact predicates. The README gives the limits of the exact results at the antimeridian.
- The winding of rings and the right-hand rule: `ringWinding`, `followsRightHandRule` and `rewind`.
- Geohashes: encode, decode, the neighbors of a cell and the cover of a box.
- The GeoJSON types of RFC 7946, and `parseGeoJson` and `parseGeometry`, which give a typed `Result`.
