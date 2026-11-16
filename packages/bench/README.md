# @geo/bench

This private package is the bench of `@mark1russell7/geo`. It compares the source of `packages/geo` with a version of geo from npm, the base of the suite. It has three suites:

- The suite `simplify` times `simplifyRegions` (roadmap item R14). Its speed gate holds a budget and a growth.
- The suite `locate` times `pointLocator` for many places against one large polygon (roadmap item R10). Its speed gate holds a budget and a growth.
- The suite `buffer` times `bufferKm` (roadmap item R16). At this time, its report only reads the claims.

The base of `simplify` and `locate` is geo 0.3.1. The base of `buffer` is geo 0.4.4, the last version before the faster buffer. The file `src/suites.ts` gives the base, the cases and the claims of each suite.

## The cases of `simplify`

Each case is a seeded map of regions with shared borders. The map has no real map data.

| Case | Regions | Positions |
| --- | ---: | ---: |
| `grid-30-1e3` | 30 | 1,000 |
| `grid-100-1e4` | 100 | 10,000 |
| `grid-552-1e5` | 552 | 100,000 |
| `tx-552-325k` | 552 | 325,000 |
| `grid-552-1e6` | 552 | 1,000,000 |

The case `tx-552-325k` has the size of the forecast zones and counties of one large state. The tolerance is 1 km.

## The cases of `locate`

Each case is a seeded polygon and a list of places. The arm starts `locatePoint` for each place.

| Case | Shape | Positions | Places |
| --- | --- | ---: | ---: |
| `coast-1e3-1e4` | One region with 4 coasts | 1,000 | 10,000 |
| `coast-1e4-1e4` | One region with 4 coasts | 10,000 | 10,000 |
| `coast-1e5-1e4` | One region with 4 coasts | 100,000 | 10,000 |
| `coast-1e6-1e2` | One region with 4 coasts | 1,000,000 | 100 |
| `star-1e5-1e3` | A star | 100,000 | 1,000 |
| `parts-552-1e5-1e3` | A MultiPolygon of 552 regions | 100,000 | 1,000 |

- The case `coast-1e5-1e4` is the target of R10: a polygon with 100,000 vertices and 10,000 places.
- A coast is a rough curve, as in the maps of `simplify`. A horizontal line crosses few of its edges.
- A horizontal line crosses approximately one quarter of the edges of a star. Thus it is the hard case of a test with a ray.
- Of the places, 98 % are uniform points in the box of the polygon with a margin of 5 %. The other 2 % are vertices.
- The product of the positions and the places is at most 1e9. Thus geo 0.3.1 can finish each round.

## The cases of `buffer`

Each case is a seeded geometry, the distance 10 km and a tolerance. The cases have no real map data.

| Case | Geometry | Positions | Tolerance | Samples |
| --- | --- | ---: | ---: | ---: |
| `coast-1e3-t3` | One region with 4 coasts | 1,000 | 3 km | 2,000 |
| `coast-1e3-t1` | One region with 4 coasts | 1,000 | 1 km | 2,000 |
| `coast-1e3-t0.3` | One region with 4 coasts | 1,000 | 0.3 km | 2,000 |
| `coast-1e5-t1` | One region with 4 coasts | 100,000 | 1 km | 200 |
| `line-2e3-t1` | A line along the latitude 75 | 2,000 | 1 km | 2,000 |
| `points-100-t1` | Points with circles that overlap | 100 | 1 km | 2,000 |

- Two correct buffers can have different positions. Thus the hash is of the class of seeded samples: in or out.
- A sample at a distance from `distance - tolerance` to `distance + tolerance` can be on each side. The digest skips it.
- Half of the samples are uniform in the box of the buffer. The other half are near its boundary.
- A sample on the wrong side of a buffer stops the arm with an error. Thus the job fails.
- Near the latitude 75, a cell is narrow in longitude. Thus the case `line-2e3-t1` has more cells for each kilometer.

## The run

The workflows `bench-simplify.yml`, `bench-locate.yml` and `bench-buffer.yml` start the bench in CI. They use the job of `bench-suite.yml`. Do not start a full run on a shared computer.

```sh
gh workflow run bench-locate.yml -R mark1russell7/geo --ref <branch>
```

The bench uses `freshRun` of `@mark1russell7/rigor-bench`. Each arm of each pair, case and round starts in a fresh process. The pairs are:

- `head`: the base against the source.
- `head-copy`: the base against the source, a second time. It is the second arm of the budget verdict.
- `base~aa`: the base against the base. It gives the noise of the run.

## The report

- The time verdict compares the source with the base. It uses the band of the A/A pair.
- The budget verdict of `simplify` holds the median of the source on `tx-552-325k` to 360 ms. The target of the alerts project is 500 ms.
- The growth verdict of `simplify` holds the growth of the time for each 10 times more positions on the 552 regions to 12.
- Each limit of the gate of `simplify` is the worst value of 5 CI runs plus their spread (run 43779851312).
- The budget verdict of `locate` holds the median of the source on `coast-1e5-1e4` to 86 ms. geo 0.3.1 takes 30 s to 60 s.
- The growth verdict of `locate` holds the growth of the time for each 10 times more vertices on the coasts with 10,000 places to 3.1.
- Each limit of the gate of `locate` is the worst value of 5 CI runs plus their spread (runs 43830188869, 43843439775, 43849286887, 43862267058 and 43877513514).
- The report of `buffer` reads the growth of the time on one coast for each 10 times less tolerance. A cost in proportion to the count of the cells gives 10. It has no budget at this time.
- The hashes show that the source gives the same result as the base on each case. A different hash or a missing hash fails the job.
- One gate line shows the speed read on the check of the run. It is an error in an enforced suite, and a warning in a suite that only reads its claims.

The artifact of the run keeps the raw records, the hashes, the facts of the computer and the report. It also keeps a CPU profile of the source on the case of the profile of the suite.
