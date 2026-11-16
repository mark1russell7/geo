# @geo/bench

This private package is the bench of `@mark1russell7/geo`. It compares the source of `packages/geo` with geo 0.3.1 from npm. It has two suites:

- The suite `simplify` times `simplifyRegions` (roadmap item R14). Its speed gate holds a budget and a growth.
- The suite `locate` times `locatePoint` for many places against one large polygon (roadmap item R10). At this time, its report only reads the speed claims.

The file `src/suites.ts` gives the cases and the claims of each suite.

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

## The run

The workflows `bench-simplify.yml` and `bench-locate.yml` start the bench in CI. They use the job of `bench-suite.yml`. Do not start a full run on a shared computer.

```sh
gh workflow run bench-locate.yml -R mark1russell7/geo --ref <branch>
```

The bench uses `freshRun` of `@mark1russell7/rigor-bench`. Each arm of each pair, case and round starts in a fresh process. The pairs are:

- `head`: geo 0.3.1 against the source.
- `head-copy`: geo 0.3.1 against the source, a second time. It is the second arm of the budget verdict.
- `base~aa`: geo 0.3.1 against geo 0.3.1. It gives the noise of the run.

## The report

- The time verdict compares the source with geo 0.3.1. It uses the band of the A/A pair.
- The budget verdict of `simplify` holds the median of the source on `tx-552-325k` to 360 ms. The target of the alerts project is 500 ms.
- The growth verdict of `simplify` holds the growth of the time for each 10 times more positions on the 552 regions to 12.
- Each limit of the gate of `simplify` is the worst value of 5 CI runs plus their spread (run 43779851312).
- The growth read of `locate` reads the coasts with 10,000 places. It has no budget until the index of R10 and its 5 CI runs.
- The hashes show that the source gives the same result as geo 0.3.1 on each case. A different hash or a missing hash fails the job.
- One gate line shows the speed read on the check of the run. It is an error in an enforced suite, and a warning in the other suite.

The artifact of the run keeps the raw records, the hashes, the facts of the computer and the report. It also keeps a CPU profile of the source on the case of the profile of the suite.
