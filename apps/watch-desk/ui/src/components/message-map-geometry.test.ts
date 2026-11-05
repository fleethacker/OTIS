import { expect, test } from "bun:test";
import { create } from "@bufbuild/protobuf";
import { geoArea, geoBounds, geoPath } from "d3-geo";
import { MessageRecordSchema } from "../gen/app/v1/models_pb";
import { createMessageMapProjection, featureCollection, mapLongitudeCenter, messageMapFeatures } from "./message-map-geometry";

const location = (extra: Record<string, unknown> = {}) => ({
  id: "g1", type: "position", label: "Exercise position", datum: "WGS84",
  datum_source: "default", status: "inferred", ...extra,
});
const message = (locations: unknown) => create(MessageRecordSchema, { structuredPayloadJson: JSON.stringify({ locations }) });

test("map extraction uses indexed coordinates in longitude/latitude order and preserves source labels", () => {
  const source = message([
    location({ point: { lat: 0, lon: 0 } }),
    location({ label: "Exercise line", type: "channel", shape: { type: "LineString", coordinates: [[150, 25], [151, 26]] } }),
    location({ label: "Shape position", shape: { type: "Point", coordinates: [-72, 37] } }),
  ]);
  const before = source.structuredPayloadJson;
  const features = messageMapFeatures(source);
  expect(features.map((feature) => feature.properties.label)).toEqual(["Exercise position", "Exercise line", "Shape position"]);
  expect(features[0].geometry).toEqual({ type: "Point", coordinates: [0, 0] });
  expect(features[1].geometry).toEqual({ type: "LineString", coordinates: [[150, 25], [151, 26]] });
  expect(features[2].geometry).toEqual({ type: "Point", coordinates: [-72, 37] });
  expect(source.structuredPayloadJson).toBe(before);
  expect(features.every((feature) => !("id" in feature.properties))).toBe(true);
});

test("names, unresolved datums, malformed coordinates and conflicting geometry do not create map locations", () => {
  expect(messageMapFeatures(message([
    location({ status: "unresolved", label: "Named harbor" }),
    location({ status: "unresolved", point: { lat: 20, lon: 30 } }),
    location({ datum: "NAD27", point: { lat: 20, lon: 30 } }),
    location({ point: { lat: 91, lon: 0 } }),
    location({ point: { lat: 0, lon: 181 } }),
    location({ point: { lat: "20", lon: 30 } }),
    location({ point: { lat: null, lon: 30 } }),
    location({ point: { lat: 20, lon: 30 }, shape: { type: "Point", coordinates: [30, 20] } }),
    location({ shape: { type: "LineString", coordinates: [[0, 0], [0, 0]] } }),
    location({ shape: { type: "Point", coordinates: [30, 20, 100] } }),
  ]))).toEqual([]);
  expect(messageMapFeatures(create(MessageRecordSchema, { structuredPayloadJson: "{" }))).toEqual([]);
  expect(messageMapFeatures(create(MessageRecordSchema))).toEqual([]);
});

test("polygons normalize spherical winding for D3 and retain holes without changing source data", () => {
  const exterior = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const hole = [[2, 2], [2, 4], [4, 4], [4, 2], [2, 2]];
  const source = message([location({ type: "area", shape: { type: "Polygon", coordinates: [exterior, hole] } })]);
  const before = source.structuredPayloadJson;
  const [feature] = messageMapFeatures(source);
  if (feature.geometry.type !== "Polygon") throw new Error("Expected polygon");
  const outerArea = geoArea({ type: "Polygon", coordinates: [feature.geometry.coordinates[0]] });
  const holeArea = geoArea({ type: "Polygon", coordinates: [feature.geometry.coordinates[1]] });
  expect(outerArea).toBeLessThan(2 * Math.PI);
  expect(holeArea).toBeGreaterThan(2 * Math.PI);
  expect(geoArea(feature)).toBeLessThan(outerArea);
  expect(geoArea(feature)).toBeGreaterThan(0);
  expect(source.structuredPayloadJson).toBe(before);
});

test("invalid rings are omitted instead of being closed or repaired by the display", () => {
  expect(messageMapFeatures(message([
    location({ type: "area", shape: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] } }),
    location({ type: "area", shape: { type: "Polygon", coordinates: [[[0, 0], [0, 0], [0, 0], [0, 0]]] } }),
    location({ type: "area", shape: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 91], [0, 0]]] } }),
  ]))).toEqual([]);
});

test("circle radius is interpreted in meters and only the rendering geometry is approximated", () => {
  const source = message([location({ type: "circle_center", point: { lat: 0, lon: 0 }, radius_m: 111_195.0802335329 })]);
  const before = source.structuredPayloadJson;
  const [circle] = messageMapFeatures(source);
  const bounds = geoBounds(circle);
  expect(circle.properties.kind).toBe("circle");
  expect(circle.properties.radiusMeters).toBeCloseTo(111_195.08, 2);
  expect(bounds[0][0]).toBeCloseTo(-1, 2);
  expect(bounds[0][1]).toBeCloseTo(-1, 2);
  expect(bounds[1][0]).toBeCloseTo(1, 2);
  expect(bounds[1][1]).toBeCloseTo(1, 2);
  expect(source.structuredPayloadJson).toBe(before);
  expect(messageMapFeatures(message([location({ point: { lat: 0, lon: 0 }, radius_m: -1 })]))).toEqual([]);
  const [zero] = messageMapFeatures(message([location({ point: { lat: 0, lon: 0 }, radius_m: 0 })]));
  expect(zero.geometry.type).toBe("Point");
});

test("dateline geometry fits nearby coordinates together instead of spanning the world", () => {
  const features = messageMapFeatures(message([
    location({ type: "area", shape: { type: "Polygon", coordinates: [[[179, -2], [-179, -2], [-179, 2], [179, 2], [179, -2]]] } }),
    location({ type: "channel", shape: { type: "LineString", coordinates: [[178, 0], [-178, 0]] } }),
  ]));
  expect(Math.abs(mapLongitudeCenter(features))).toBeCloseTo(180, 5);
  const projection = createMessageMapProjection(features, 720, 320);
  const left = projection([178, 0])!;
  const right = projection([-178, 0])!;
  expect(Math.abs(left[0] - right[0])).toBeGreaterThan(100);
  expect(Math.abs(left[0] - right[0])).toBeLessThan(720);
  expect(left[1]).toBeCloseTo(right[1], 5);
  const [[minX, minY], [maxX, maxY]] = geoPath(projection).bounds(featureCollection(features));
  expect(minX).toBeGreaterThanOrEqual(27);
  expect(minY).toBeGreaterThanOrEqual(27);
  expect(maxX).toBeLessThanOrEqual(693);
  expect(maxY).toBeLessThanOrEqual(293);
  expect(geoArea(features[0])).toBeLessThan(0.01);
});

test("one point, empty data, and invalid viewport sizes retain finite usable projections", () => {
  const features = messageMapFeatures(message([location({ point: { lat: 42, lon: -71 } })]));
  const projection = createMessageMapProjection(features, 720, 320);
  const point = projection([-71, 42])!;
  expect(point[0]).toBeCloseTo(360);
  expect(point[1]).toBeCloseTo(160);
  expect(Number.isFinite(projection.scale())).toBe(true);
  expect(projection.scale()).toBeLessThan(4_000);
  expect(geoPath(projection)(features[0])).not.toContain("NaN");
  const fallback = createMessageMapProjection([], NaN, -1);
  expect(fallback([0, 0])!.every(Number.isFinite)).toBe(true);
});

test("oversized geometry and excessive location counts stay bounded", () => {
  const line = Array.from({ length: 4_097 }, (_, index) => [index % 2, 0]);
  expect(messageMapFeatures(message([location({ shape: { type: "LineString", coordinates: line } })]))).toEqual([]);
  expect(messageMapFeatures(message(Array.from({ length: 500 }, () => location({ point: { lat: 0, lon: 0 } }))))).toHaveLength(256);
});
