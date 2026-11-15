# Changelog

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
