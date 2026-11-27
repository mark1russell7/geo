/**
 * This file is the setup of each test file of the package. It gives each property test of fast-check one fixed seed.
 * Thus two runs of one tree give the same cases and the same coverage, and the coverage floors hold.
 *
 * To examine other cases, set the variable `FC_SEED` to a different integer for one run.
 */
import fc from "fast-check";

/** The seed of the property tests when the variable `FC_SEED` is not set. */
export const PROPERTY_SEED = 20_261_126;

const fromEnv = process.env["FC_SEED"];
fc.configureGlobal({ seed: fromEnv === undefined || fromEnv === "" ? PROPERTY_SEED : Number.parseInt(fromEnv, 10) });
