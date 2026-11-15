# @geo/bench

This private package is the bench of `simplifyRegions` of `@mark1russell7/geo` (roadmap item R14). It compares the source of `packages/geo` with geo 0.3.1 from npm.

## The cases

Each case is a seeded map of regions with shared borders. The map has no real map data.

| Case | Regions | Positions |
| --- | ---: | ---: |
| `grid-30-1e3` | 30 | 1,000 |
| `grid-100-1e4` | 100 | 10,000 |
| `grid-552-1e5` | 552 | 100,000 |
| `tx-552-325k` | 552 | 325,000 |
| `grid-552-1e6` | 552 | 1,000,000 |

The case `tx-552-325k` has the size of the forecast zones and counties of one large state. The tolerance is 1 km.

## The run

The workflow `bench-simplify.yml` starts the bench in CI. Do not start a full run on a shared computer.

```sh
gh workflow run bench-simplify.yml -R mark1russell7/geo --ref <branch>
```

The bench uses `freshRun` of `@mark1russell7/rigor-bench`. Each arm of each pair, case and round starts in a fresh process. The pairs are:

- `head`: geo 0.3.1 against the source.
- `head-copy`: geo 0.3.1 against the source, a second time. It is the second arm of the budget verdict.
- `base~aa`: geo 0.3.1 against geo 0.3.1. It gives the noise of the run.

## The report

- The time verdict compares the source with geo 0.3.1. It uses the band of the A/A pair.
- The budget verdict holds the median of the source on `tx-552-325k` to 500 ms.
- The growth verdict reads the growth of the time for each 10 times more positions on the 552 regions.
- The hashes show that the source gives the same result as geo 0.3.1 on each case. A different hash or a missing hash fails the job.

The artifact of the run keeps the raw records, the hashes, the facts of the computer and the report. It also keeps a CPU profile of the source on `tx-552-325k`.
