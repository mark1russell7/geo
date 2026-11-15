import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import type { LatLon, Position } from "@mark1russell7/geo";
import { byId, copyText, setupTheme } from "@mark1russell7/site-pages/chrome";
import { clampCenter, GeoMap, type Projection } from "./globe.ts";
import { addCorner, areaOf, bufferSentence, closeDraft, codeLines, formatLat, formatLon, PRESETS, presetOf, readout, sentence } from "./model.ts";

setupTheme(byId<HTMLButtonElement>("theme"), "theme");
const copy = byId<HTMLButtonElement>("copy");
copy.addEventListener("click", () => {
  void copyText(copy, byId("install").textContent ?? "");
});

const ZOOMS = [1, 1.5, 2.25, 3.5, 5, 8] as const;
const first = PRESETS[0] as (typeof PRESETS)[number];

/** The state of the demo. A render reads it, and each event changes it. */
const state = {
  preset: first.id as string,
  ring: first.ring as readonly Position[],
  note: first.note,
  drawing: false,
  draft: [] as Position[],
  place: first.place,
  center: first.view as readonly [number, number],
  projection: "globe" as Projection,
  zoom: 0,
  bufferKm: 600,
  precision: 3,
};

const normalLon = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;
const zoomOf = (): number => ZOOMS[state.zoom] ?? 1;

const svg = byId("map") as unknown as SVGSVGElement;
const map = new GeoMap(svg, {
  turn(center) {
    state.center = center;
    render();
  },
  place(place) {
    setPlace(place);
  },
  tap(point) {
    if (!state.drawing) {
      setPlace(point);
      return;
    }
    const next = addCorner(state.draft, point);
    if (next === undefined) {
      byId("draw-help").textContent = "That corner goes round the world a second time. Close the area, or cancel.";
      return;
    }
    state.draft = next;
    render();
  },
  close() {
    finishDraft();
  },
});

function setPlace(place: LatLon): void {
  state.place = { lat: Math.max(-90, Math.min(90, place.lat)), lon: normalLon(place.lon) };
  render();
}

function finishDraft(): void {
  const ring = closeDraft(state.draft);
  if (ring === undefined) return;
  state.ring = ring;
  state.preset = "drawn";
  state.note = `Your area has ${String(ring.length - 1)} corners. Each edge takes the short way, so an edge can cross the antimeridian.`;
  stopDrawing();
}

function stopDrawing(): void {
  state.drawing = false;
  state.draft = [];
  render();
}

const fixed = (value: number): string => String(Number(value.toFixed(2)));

function render(): void {
  const area = areaOf(state.ring);
  const result = readout(state.place, area, state.bufferKm, state.precision);
  state.center = clampCenter(state.projection, zoomOf(), state.center);
  map.draw({
    projection: state.projection,
    center: state.center,
    zoom: zoomOf(),
    ring: state.ring,
    draft: state.draft,
    place: state.place,
    result,
  });
  const answer = byId("sentence");
  answer.textContent = sentence(result);
  answer.dataset["location"] = result.location;
  byId("buffer-sentence").textContent = bufferSentence(result);
  byId("note").textContent = state.drawing ? "" : state.note;
  const code = byId("code");
  const place = document.createElement("span");
  place.className = "line";
  place.textContent = `const place = latLon(${fixed(state.place.lat)}, ${fixed(state.place.lon)}) // ${formatLat(state.place.lat)}, ${formatLon(state.place.lon)}`;
  code.replaceChildren(
    place,
    ...codeLines(result, state.precision).map((line) => {
      const row = document.createElement("span");
      row.className = "line";
      const call = document.createElement("span");
      call.className = "call";
      call.textContent = line.code;
      const value = document.createElement("span");
      value.className = "value";
      value.textContent = `// ${line.value}`;
      row.append(call, " ", value);
      return row;
    }),
  );
  const lat = byId<HTMLInputElement>("lat");
  const lon = byId<HTMLInputElement>("lon");
  if (document.activeElement !== lat) lat.value = fixed(state.place.lat);
  if (document.activeElement !== lon) lon.value = fixed(state.place.lon);
  byId("buffer-out").textContent = `${String(state.bufferKm)} km`;
  byId("precision-out").textContent = String(state.precision);
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-preset]")) {
    button.setAttribute("aria-pressed", String(!state.drawing && button.dataset["preset"] === state.preset));
  }
  byId("draw").setAttribute("aria-pressed", String(state.drawing));
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-projection]")) {
    button.setAttribute("aria-pressed", String(button.dataset["projection"] === state.projection));
  }
  byId<HTMLButtonElement>("zoom-out").disabled = state.zoom === 0;
  byId<HTMLButtonElement>("zoom-in").disabled = state.zoom === ZOOMS.length - 1;
  const bar = byId("draw-bar");
  bar.hidden = !state.drawing;
  svg.classList.toggle("drawing", state.drawing);
  if (state.drawing) {
    const corners = state.draft.length;
    byId("draw-help").textContent =
      corners === 0 ? "Tap the map to add the corners of the area." : `${String(corners)} ${corners === 1 ? "corner" : "corners"}. Tap the first corner, or close the area.`;
    byId<HTMLButtonElement>("draw-close").disabled = corners < 3;
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-preset]")) {
  button.addEventListener("click", () => {
    const preset = presetOf(button.dataset["preset"] ?? "");
    if (preset === undefined) return;
    Object.assign(state, { preset: preset.id, ring: preset.ring, note: preset.note, place: preset.place, center: preset.view, drawing: false, draft: [] });
    render();
  });
}
byId("draw").addEventListener("click", () => {
  if (state.drawing) {
    stopDrawing();
    return;
  }
  state.drawing = true;
  state.draft = [];
  render();
});
byId("draw-close").addEventListener("click", finishDraft);
byId("draw-cancel").addEventListener("click", stopDrawing);
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-projection]")) {
  button.addEventListener("click", () => {
    state.projection = button.dataset["projection"] === "flat" ? "flat" : "globe";
    render();
  });
}
byId("zoom-in").addEventListener("click", () => {
  state.zoom = Math.min(ZOOMS.length - 1, state.zoom + 1);
  render();
});
byId("zoom-out").addEventListener("click", () => {
  state.zoom = Math.max(0, state.zoom - 1);
  render();
});
const readNumber = (id: string, apply: (value: number) => void): void => {
  const input = byId<HTMLInputElement>(id);
  input.addEventListener("input", () => {
    const value = Number(input.value);
    if (input.value !== "" && Number.isFinite(value)) apply(value);
  });
};
readNumber("lat", (lat) => {
  setPlace({ lat, lon: state.place.lon });
});
readNumber("lon", (lon) => {
  setPlace({ lat: state.place.lat, lon });
});
readNumber("buffer", (km) => {
  state.bufferKm = km;
  render();
});
readNumber("precision", (precision) => {
  state.precision = precision;
  render();
});

render();
