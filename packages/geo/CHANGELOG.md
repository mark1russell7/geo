# Changelog

## 0.1.0

The first version.

- Points on WGS84: `latLon`, `parseLatLon`, `normalizeLon`, `toPosition` and `fromPosition`.
- The great-circle distance with the mean radius of the IUGG (6371.0088 km), the initial bearing and the destination.
- Bounding boxes that can cross the antimeridian: `bboxOfPoints`, `bboxOfGeoJson`, `bboxContains` and `bboxIntersects`.
- Point-in-polygon and overlap tests for Polygon and MultiPolygon, with holes, on the straight edges of RFC 7946. They use exact predicates. The README gives the limits of the exact results at the antimeridian.
- The winding of rings and the right-hand rule: `ringWinding`, `followsRightHandRule` and `rewind`.
- Geohashes: encode, decode, the neighbors of a cell and the cover of a box.
- The GeoJSON types of RFC 7946, and `parseGeoJson` and `parseGeometry`, which give a typed `Result`.
