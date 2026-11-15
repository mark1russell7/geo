# Roadmap

This file is the plan of geo. The Status page of the site reads it, and the tracker of the project mirrors it.

| ID | Item | Status | Summary |
| --- | --- | --- | --- |
| R1 | The first package | done | @mark1russell7/geo 0.1.0 is on npm: points, distance, boxes, a point in a polygon, overlap, geohash and GeoJSON. |
| R11 | A limit on the longitudes of a polygon | done | A polygon with a longitude of 1e12 made `locatePoint` run for a very long time. The tests now refuse a longitude out of -540 to 540. Version 0.2.0. |
| R2 | The distance from a place to an area | done | `distanceToGeometryKm` gives the great-circle distance from a point to a polygon, a line or a point. The alert system needs it to match a place and its buffer against the polygon of an alert. Version 0.2.1. |
| R3 | The alert system matches places by shape | done 2026-11-15 | The core of the alert system matches a place and its buffer against the polygon or the circle of an alert, with this package. Part 1: the region codes are the floor, and a shape adds a place in its buffer. Part 2: the shape of a CAP area block decides for that block. |
| R4 | Exact moves across the antimeridian | in progress | `@mark1russell7/predicates` 0.1.3 has exact predicates on moved points (algebra A27, #176), and 0.1.4 has the exact ring test `locateInRings` (A28, #178). The strategist chose predicates as the home of the ring test. geo 0.3.1 moves the point with no rounding, imports the ring test and drops its copy. It keeps only the rule of holes of GeoJSON and the test of a point on an open line. The limit of 1e-12 degrees goes. |
| R14 | Fast simplification of large states | next | `simplifyRegions` of 0.3.0 takes about 7.4 s for the 552 NWS regions of Texas (325,410 positions), and it blocks the event loop of an alert instance. The target of alerts is under 0.5 s on a CI runner. First a bench in CI with `rigor-bench` on seeded regions with shared edges, from 10^3 to 10^6 positions, and a CPU profile. Then the changes that the profile supports, with a speed gate. The prediction comes here before the code. |
| R12 | Simplify regions that share edges | done | `simplifyRegions` and `regionSimplifier` simplify the counties and zones of a state for the alert map. Neighbor regions keep one shared edge, so no gap and no overlap opens. The tolerance is in km for each zoom level. Version 0.3.0. |
| R13 | Uniform values in the property tests | done | `fc.double` with a range gives values near 0 in 93 % of the draws. Each ranged property now uses `uniformDouble` of `@mark1russell7/rigor-testkit`. |
| R6 | The live demo site | next | An interactive map: draw an area, move a place, and see the location, the distance, the box and the geohash cells. |
| R5 | `@procedures/geo` uses this package | later | `greatCircleKm` and the geohash of `@procedures/geo` become calls of this package. |
| R7 | Circles and buffers as polygons | later | A circle on the Earth as a polygon, also across the antimeridian and around a pole. |
| R10 | Large polygons and many places | later | An index of the edges, and a bench in CI for each power of ten. |
| R8 | The distance between two areas | later | The great-circle distance between two geometries. |
| R9 | Geodesics on the WGS84 ellipsoid | later | The distance, the bearing and the destination on the ellipsoid, with the method of Karney. |
