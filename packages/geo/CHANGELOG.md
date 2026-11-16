# Changelog

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
