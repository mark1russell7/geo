/**
 * The probe of the home page. The site check of the Pages workflow starts it in a browser at each width, before the
 * deploy. A failed check stops the deploy.
 *
 * The probe uses the demo as a visitor does. It picks each area, moves the place, changes the view and draws an area.
 * The site check reads this TypeScript file directly. It removes the types, and it starts the result as the body of
 * an async function.
 */

// The site check gives these helpers to the probe.
declare const check: (name: string, ok: unknown, detail?: unknown) => boolean;
declare const until: <T>(fn: () => T | Promise<T>, ms?: number) => Promise<T>;
declare const $: (selector: string) => Element | null;
declare const $$: (selector: string) => Element[];
declare const click: (target: string | Element) => void;

const text = (selector: string): string => $(selector)?.textContent ?? "";
const location = (): string => $("#sentence")?.getAttribute("data-location") ?? "";
const drawn = (name: string): boolean => ($(`#map path.${name}`)?.getAttribute("d") ?? "").length > 0;
const fits = (): boolean => document.documentElement.scrollWidth <= window.innerWidth;
const pressed = (selector: string): boolean => $(selector)?.getAttribute("aria-pressed") === "true";
const setValue = (id: string, value: string): void => {
  const input = $(`#${id}`) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
/** This function taps the map at a fraction of its width and height. */
const tapMap = (x: number, y: number): void => {
  const map = $("#map") as SVGSVGElement;
  const box = map.getBoundingClientRect();
  map.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: box.left + box.width * x, clientY: box.top + box.height * y }));
};

// The first view: the area across the antimeridian, with the place inside it.
check("the demo draws the globe", await until(() => drawn("sphere") && drawn("area")));
check("the first area is across the antimeridian", pressed('[data-preset="antimeridian"]'));
check("the place is inside the first area", location() === "inside", text("#sentence"));
check("the readout says it in plain words", text("#sentence") === "The place is inside the area.", text("#sentence"));
check("the code view shows the value of locatePoint", text("#code").includes('locatePoint(place, area) // "inside"'), text("#code"));
check("the map draws the geohash cell and the box", drawn("cell") && drawn("box"));
check("the place mark is on the globe", ($(".place-mark") as SVGGElement | null)?.style.display !== "none");
check("the first view fits the width of the page", fits(), [document.documentElement.scrollWidth, window.innerWidth]);

// The same corners the long way round: the place is outside.
click('[data-preset="long-way"]');
check("the long way round puts the place outside", await until(() => location() === "outside"), text("#sentence"));
check("the readout gives the distance to the edge", /outside the area, [\d,.]+ km from its edge/.test(text("#sentence")), text("#sentence"));
check("a buffer of 600 km does not meet the area", text("#buffer-sentence").includes("does not meet"), text("#buffer-sentence"));
setValue("buffer", "2000");
check("a buffer of 2,000 km meets the area", await until(() => text("#buffer-sentence").includes("2,000 km round the place meets")), text("#buffer-sentence"));

// The pole, on the flat map.
click('[data-preset="pole"]');
check("the pole area puts its place inside", await until(() => location() === "inside"), text("#sentence"));
click('[data-projection="flat"]');
check("the flat map is an equirectangular map", await until(() => $("#map")?.getAttribute("data-projection") === "flat"));
check("the flat map draws the pole area", drawn("area"));
check("the flat map fits the width of the page", fits(), [document.documentElement.scrollWidth, window.innerWidth]);

// The place from the inputs.
setValue("lat", "60");
check("a place at 60° N is outside the pole area", await until(() => location() === "outside"), text("#sentence"));
setValue("precision", "5");
check("the geohash length changes the code view", await until(() => /geohash\(place, 5\) \/\/ "[0-9b-hjkmnp-z]{5}"/.test(text("#code"))), text("#code"));

// The zoom.
click("#zoom-in");
check("the zoom out button is on after a zoom in", await until(() => !($("#zoom-out") as HTMLButtonElement).disabled));
click("#zoom-out");

// A drawn area: three taps and Close.
click('[data-projection="globe"]');
click("#draw");
check("the draw mode shows its help", await until(() => !($("#draw-bar") as HTMLElement).hidden), text("#draw-help"));
tapMap(0.4, 0.4);
tapMap(0.6, 0.4);
tapMap(0.5, 0.6);
check("three taps give three corners", await until(() => $$("#map .corners circle").length === 3), $$("#map .corners circle").length);
check("the close button is on with three corners", !($("#draw-close") as HTMLButtonElement).disabled);
click("#draw-close");
check("Close makes the drawn area", await until(() => ($("#draw-bar") as HTMLElement).hidden && drawn("area")));
check("the note tells the corners of the drawn area", text("#note").startsWith("Your area has 3 corners."), text("#note"));
check("the drawn view fits the width of the page", fits(), [document.documentElement.scrollWidth, window.innerWidth]);

// Back to the first area for the screenshots.
click('[data-preset="antimeridian"]');
setValue("buffer", "600");
setValue("precision", "3");
check("the first area is back", await until(() => location() === "inside"), text("#sentence"));

export {};
