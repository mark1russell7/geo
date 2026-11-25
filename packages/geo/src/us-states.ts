/**
 * The states of the United States, the District of Columbia and the territories, with their codes. Each record has the
 * FIPS code of the Census Bureau, the code of the Postal Service and the name. Data sets often name a state by one of
 * the two codes, and a person reads the name.
 *
 * Source: the state codes of the Census Bureau (ANSI INCITS 38), a work of the United States government in the public
 * domain.
 *
 * @packageDocumentation
 */

/** The kind of a first-level division of the United States. */
export type UsStateKind = "state" | "district" | "territory";

/** One state, the district or one territory of the United States. */
export interface UsState {
  /** The FIPS code of the Census Bureau, two digits, for example `"06"`. */
  readonly fips: string;
  /** The code of the Postal Service, two capital letters, for example `"CA"`. */
  readonly usps: string;
  /** The name, for example `"California"`. */
  readonly name: string;
  readonly kind: UsStateKind;
}

const row = (fips: string, usps: string, name: string, kind: UsStateKind = "state"): UsState => Object.freeze({ fips, usps, name, kind });

/** The 50 states, the District of Columbia and the 6 territories with a FIPS code, in the order of the FIPS codes. */
export const US_STATES: readonly UsState[] = Object.freeze([
  row("01", "AL", "Alabama"),
  row("02", "AK", "Alaska"),
  row("04", "AZ", "Arizona"),
  row("05", "AR", "Arkansas"),
  row("06", "CA", "California"),
  row("08", "CO", "Colorado"),
  row("09", "CT", "Connecticut"),
  row("10", "DE", "Delaware"),
  row("11", "DC", "District of Columbia", "district"),
  row("12", "FL", "Florida"),
  row("13", "GA", "Georgia"),
  row("15", "HI", "Hawaii"),
  row("16", "ID", "Idaho"),
  row("17", "IL", "Illinois"),
  row("18", "IN", "Indiana"),
  row("19", "IA", "Iowa"),
  row("20", "KS", "Kansas"),
  row("21", "KY", "Kentucky"),
  row("22", "LA", "Louisiana"),
  row("23", "ME", "Maine"),
  row("24", "MD", "Maryland"),
  row("25", "MA", "Massachusetts"),
  row("26", "MI", "Michigan"),
  row("27", "MN", "Minnesota"),
  row("28", "MS", "Mississippi"),
  row("29", "MO", "Missouri"),
  row("30", "MT", "Montana"),
  row("31", "NE", "Nebraska"),
  row("32", "NV", "Nevada"),
  row("33", "NH", "New Hampshire"),
  row("34", "NJ", "New Jersey"),
  row("35", "NM", "New Mexico"),
  row("36", "NY", "New York"),
  row("37", "NC", "North Carolina"),
  row("38", "ND", "North Dakota"),
  row("39", "OH", "Ohio"),
  row("40", "OK", "Oklahoma"),
  row("41", "OR", "Oregon"),
  row("42", "PA", "Pennsylvania"),
  row("44", "RI", "Rhode Island"),
  row("45", "SC", "South Carolina"),
  row("46", "SD", "South Dakota"),
  row("47", "TN", "Tennessee"),
  row("48", "TX", "Texas"),
  row("49", "UT", "Utah"),
  row("50", "VT", "Vermont"),
  row("51", "VA", "Virginia"),
  row("53", "WA", "Washington"),
  row("54", "WV", "West Virginia"),
  row("55", "WI", "Wisconsin"),
  row("56", "WY", "Wyoming"),
  row("60", "AS", "American Samoa", "territory"),
  row("66", "GU", "Guam", "territory"),
  row("69", "MP", "Northern Mariana Islands", "territory"),
  row("72", "PR", "Puerto Rico", "territory"),
  row("74", "UM", "U.S. Minor Outlying Islands", "territory"),
  row("78", "VI", "U.S. Virgin Islands", "territory"),
]);

const BY_CODE: ReadonlyMap<string, UsState> = new Map(US_STATES.flatMap((state) => [[state.fips, state], [state.usps, state]] as const));

/**
 * This function finds a state, the district or a territory by its FIPS code (`"06"`) or its postal code (`"CA"` or `"ca"`).
 *
 * @returns The record, or `undefined` when no record has the code. A FIPS code has two digits: `"6"` gives `undefined`.
 */
export function usState(code: string): UsState | undefined {
  return BY_CODE.get(code.toUpperCase());
}
