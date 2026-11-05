import { geoArea, geoBounds, geoCircle, geoEquirectangular, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, LineString, Point, Polygon, Position } from "geojson";
import type { MessageRecord } from "../gen/app/v1/models_pb";
import { isObject, structuredPayload, type Fields, type Value } from "./structured-message-format";

const EARTH_RADIUS_METERS = 6_371_008.8;
const MAX_LOCATIONS = 256;
const MAX_COORDINATES = 16_384;
const MAX_SHAPE_COORDINATES = 4_096;
const FULL_SPHERE_AREA = 4 * Math.PI;

export type MessageMapFeature = Feature<Point | LineString | Polygon, {
  label: string;
  kind: "point" | "line" | "polygon" | "circle";
  radiusMeters?: number;
}>;

function coordinate(value: Value | undefined): value is [number, number] {
  return Array.isArray(value) && value.length === 2 &&
    typeof value[0] === "number" && Number.isFinite(value[0]) && Math.abs(value[0]) <= 180 &&
    typeof value[1] === "number" && Number.isFinite(value[1]) && Math.abs(value[1]) <= 90;
}

function samePosition(left: Position, right: Position) {
  return left[0] === right[0] && left[1] === right[1];
}

function shapeGeometry(shape: Fields): Point | LineString | Polygon | undefined {
  const positions = shape.coordinates;
  if (shape.type === "Point" && coordinate(positions)) {
    return { type: "Point", coordinates: [...positions] };
  }
  if (!Array.isArray(positions)) return;
  if (shape.type === "LineString") {
    if (positions.length < 2 || positions.length > MAX_SHAPE_COORDINATES || !positions.every(coordinate)) return;
    if (positions.every((position) => samePosition(position, positions[0]))) return;
    return { type: "LineString", coordinates: positions.map((position) => [...position]) };
  }
  if (shape.type !== "Polygon" || positions.length === 0 || positions.length > MAX_SHAPE_COORDINATES / 4) return;
  const rings: Position[][] = [];
  let count = 0;
  for (const value of positions) {
    if (!Array.isArray(value) || value.length < 4 || value.length > MAX_SHAPE_COORDINATES || !value.every(coordinate)) return;
    count += value.length;
    if (count > MAX_SHAPE_COORDINATES || !samePosition(value[0], value[value.length - 1])) return;
    const ring = value.map((position) => [...position]);
    const area = geoArea({ type: "Polygon", coordinates: [ring] });
    const smallArea = Math.min(area, FULL_SPHERE_AREA - area);
    if (!Number.isFinite(smallArea) || smallArea < 1e-15) return;
    // D3's spherical winding is opposite RFC 7946 for ordinary local areas.
    // Measure on the sphere so a ring crossing 180° is not reversed by a planar test.
    const shouldBeSmall = rings.length === 0;
    if ((area < 2 * Math.PI) !== shouldBeSmall) ring.reverse();
    rings.push(ring);
  }
  return { type: "Polygon", coordinates: rings };
}

function coordinateCount(geometry: Point | LineString | Polygon) {
  if (geometry.type === "Point") return 1;
  if (geometry.type === "LineString") return geometry.coordinates.length;
  return geometry.coordinates.reduce((total, ring) => total + ring.length, 0);
}

/** Only use the indexed, datum-resolved location contract; never geocode names or raw text. */
export function messageMapFeatures(message: MessageRecord): MessageMapFeature[] {
  const locations = structuredPayload(message)?.locations;
  if (!Array.isArray(locations)) return [];
  const features: MessageMapFeature[] = [];
  let coordinateBudget = MAX_COORDINATES;
  for (const value of locations.slice(0, MAX_LOCATIONS)) {
    if (!isObject(value) || value.status !== "inferred" || value.datum !== "WGS84") continue;
    // The contract permits exactly one geometry representation per location.
    if ((value.point !== undefined) === (value.shape !== undefined)) continue;
    let geometry: Point | LineString | Polygon | undefined;
    if (value.point !== undefined && isObject(value.point)) {
      const position = [value.point.lon, value.point.lat];
      if (coordinate(position)) geometry = { type: "Point", coordinates: position };
    } else if (value.shape !== undefined && isObject(value.shape)) {
      geometry = shapeGeometry(value.shape);
    }
    if (!geometry) continue;
    let kind: MessageMapFeature["properties"]["kind"] = geometry.type === "Point" ? "point" : geometry.type === "LineString" ? "line" : "polygon";
    let radiusMeters: number | undefined;
    if (geometry.type === "Point" && value.radius_m !== undefined) {
      if (typeof value.radius_m !== "number" || !Number.isFinite(value.radius_m) || value.radius_m < 0 || value.radius_m >= Math.PI * EARTH_RADIUS_METERS) continue;
      radiusMeters = value.radius_m;
      kind = "circle";
      // Rendering only: the stored source remains a center plus radius in meters.
      if (radiusMeters > 0) {
        geometry = geoCircle().center([geometry.coordinates[0], geometry.coordinates[1]])
          .radius(radiusMeters / EARTH_RADIUS_METERS * 180 / Math.PI).precision(3)();
      }
    }
    const count = coordinateCount(geometry);
    if (count > coordinateBudget) continue;
    coordinateBudget -= count;
    const label = typeof value.label === "string" && value.label.trim() ? value.label.trim() :
      kind === "point" ? "Position" : kind === "line" ? "Line" : kind === "circle" ? "Circle" : "Area";
    features.push({ type: "Feature", geometry, properties: { label, kind, ...(radiusMeters !== undefined ? { radiusMeters } : {}) } });
  }
  return features;
}

export function featureCollection(features: MessageMapFeature[]): FeatureCollection<MessageMapFeature["geometry"], MessageMapFeature["properties"]> {
  return { type: "FeatureCollection", features };
}

/** Keep nearby points either side of the antimeridian adjacent in the viewport. */
export function mapLongitudeCenter(features: MessageMapFeature[]): number {
  if (!features.length) return 0;
  const [[west], [east]] = geoBounds(featureCollection(features));
  if (!Number.isFinite(west) || !Number.isFinite(east)) return 0;
  const center = (west + (east < west ? east + 360 : east)) / 2;
  return center > 180 ? center - 360 : center;
}

export function createMessageMapProjection(features: MessageMapFeature[], width: number, height: number) {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 720;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 320;
  const padding = Math.min(28, safeWidth / 10, safeHeight / 10);
  const innerWidth = safeWidth - 2 * padding;
  const innerHeight = safeHeight - 2 * padding;
  const projection = geoEquirectangular().rotate([-mapLongitudeCenter(features), 0]).scale(1).translate([0, 0]);
  const [[left, top], [right, bottom]] = geoPath(projection).bounds(featureCollection(features));
  const fallbackScale = Math.min(innerWidth / (2 * Math.PI), innerHeight / Math.PI);
  if ([left, top, right, bottom].every(Number.isFinite)) {
    // A single position or a very small shape still needs useful geographic context.
    const maximumScale = Math.min(innerWidth, innerHeight) / (5 * Math.PI / 180);
    const scale = Math.min(innerWidth / Math.max(right - left, 1e-12), innerHeight / Math.max(bottom - top, 1e-12), maximumScale);
    projection.scale(scale).translate([safeWidth / 2 - scale * (left + right) / 2, safeHeight / 2 - scale * (top + bottom) / 2]);
  } else {
    projection.scale(fallbackScale).translate([safeWidth / 2, safeHeight / 2]);
  }
  return projection.clipExtent([[0, 0], [safeWidth, safeHeight]]);
}
