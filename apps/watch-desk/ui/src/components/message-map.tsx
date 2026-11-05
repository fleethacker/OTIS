import { useId, useMemo, useRef, useState } from "react";
import { geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { TbChevronDown, TbFocus2, TbMap, TbMinus, TbPlus } from "react-icons/tb";
import countriesTopology from "../assets/maps/countries-110m.json";
import type { MessageRecord } from "../gen/app/v1/models_pb";
import {
  createMessageMapProjection,
  messageMapFeatures,
  type MessageMapFeature,
} from "./message-map-geometry";
import { AppButton } from "./ui";

const WIDTH = 720;
const HEIGHT = 360;
const topology = countriesTopology as unknown as Topology<{ countries: GeometryCollection }>;
// Bundled country data only: opening a map never contacts a tile or geocoding service.
const countries = feature(topology, topology.objects.countries);

export function MessageMap({ message }: { message: MessageRecord }) {
  const features = useMemo(() => messageMapFeatures(message), [message.structuredPayloadJson]);
  if (!features.length) return null;
  return <MapDisclosure key={message.sourceMessageId} features={features} />;
}

function MapDisclosure({ features }: { features: MessageMapFeature[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section className="message-map-disclosure" aria-label="Message chart">
      <button
        type="button"
        className="message-map-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <TbMap aria-hidden="true" />
        <span>Chart</span>
        <TbChevronDown className="message-map-chevron" aria-hidden="true" />
      </button>
      <div id={id} hidden={!open}>
        {open && <MapCanvas features={features} />}
      </div>
    </section>
  );
}

function MapCanvas({ features }: { features: MessageMapFeature[] }) {
  const id = useId();
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<[number, number]>([0, 0]);
  const [active, setActive] = useState<string>();
  const drag = useRef<{ x: number; y: number; offset: [number, number] } | null>(null);
  const base = useMemo(() => createMessageMapProjection(features, WIDTH, HEIGHT), [features]);
  const projection = useMemo(() => {
    const next = createMessageMapProjection(features, WIDTH, HEIGHT);
    const [x, y] = base.translate();
    return next.scale(base.scale() * zoom).translate([
      WIDTH / 2 + (x - WIDTH / 2) * zoom + offset[0],
      HEIGHT / 2 + (y - HEIGHT / 2) * zoom + offset[1],
    ]).clipExtent([[0, 0], [WIDTH, HEIGHT]]);
  }, [features, base, zoom, offset]);
  const paths = useMemo(() => {
    const path = geoPath(projection).pointRadius(5);
    const layer = (item: MessageMapFeature) => item.geometry.type === "Point" ? 2 : item.geometry.type === "LineString" ? 1 : 0;
    return {
      countries: path(countries) ?? undefined,
      features: features.map((item, index) => ({ item, index, path: path(item) ?? undefined }))
        .sort((a, b) => layer(a.item) - layer(b.item)),
    };
  }, [features, projection]);
  const degreesAcross = WIDTH / projection.scale() * 180 / Math.PI;
  const step = degreesAcross < 5 ? 0.5 : degreesAcross < 15 ? 1 : degreesAcross < 40 ? 5 : degreesAcross < 100 ? 10 : 30;
  const [originX, originY] = projection.translate();
  const west = Math.max(0, originX - Math.PI * projection.scale());
  const east = Math.min(WIDTH, originX + Math.PI * projection.scale());
  const north = Math.max(0, originY - Math.PI / 2 * projection.scale());
  const south = Math.min(HEIGHT, originY + Math.PI / 2 * projection.scale());
  const labels: { x: number; y: number; text: string; axis: "lat" | "lon" }[] = [];
  for (let lon = -180; lon < 180; lon += step) {
    const point = projection([lon, 0]);
    if (point && point[0] > 38 && point[0] < WIDTH - 28 && north < south) labels.push({ x: point[0], y: south - 9, text: `${Math.abs(lon)}°${lon < 0 ? "W" : lon > 0 ? "E" : ""}`, axis: "lon" });
  }
  for (let lat = -90; lat <= 90; lat += step) {
    const point = projection([0, lat]);
    if (point && point[1] > 20 && point[1] < HEIGHT - 28 && west < east) labels.push({ x: west + 8, y: point[1] - 5, text: `${Math.abs(lat)}°${lat < 0 ? "S" : lat > 0 ? "N" : ""}`, axis: "lat" });
  }
  const changeZoom = (factor: number) => {
    const next = Math.min(8, Math.max(0.125, zoom * factor));
    setOffset(([x, y]) => [x * next / zoom, y * next / zoom]);
    setZoom(next);
  };
  const reset = () => { setZoom(1); setOffset([0, 0]); };
  return (
    <div className="message-map-canvas">
      <div className="message-map-controls" role="group" aria-label="Chart controls">
        <AppButton size="xs" variant="ghost" aria-label="Zoom in" title="Zoom in" disabled={zoom >= 8} onClick={() => changeZoom(2)}><TbPlus aria-hidden="true" /></AppButton>
        <AppButton size="xs" variant="ghost" aria-label="Zoom out" title="Zoom out" disabled={zoom <= 0.125} onClick={() => changeZoom(0.5)}><TbMinus aria-hidden="true" /></AppButton>
        <AppButton size="xs" variant="ghost" aria-label="Fit message locations" title="Fit message locations" onClick={reset}><TbFocus2 aria-hidden="true" /></AppButton>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="group"
        aria-label="Message coordinates and shapes"
        aria-describedby={`${id}-help`}
        tabIndex={0}
        onKeyDown={(event) => {
          const moves: Record<string, [number, number]> = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
          if (moves[event.key]) {
            event.preventDefault();
            const [x, y] = moves[event.key];
            setOffset(([oldX, oldY]) => [oldX + x, oldY + y]);
          } else if (["+", "=", "-", "Home"].includes(event.key)) {
            event.preventDefault();
            if (event.key === "Home") reset();
            else changeZoom(event.key === "-" ? 0.5 : 2);
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const rect = event.currentTarget.getBoundingClientRect();
          drag.current = { x: event.clientX * WIDTH / rect.width, y: event.clientY * WIDTH / rect.width, offset };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          const rect = event.currentTarget.getBoundingClientRect();
          setOffset([
            drag.current.offset[0] + event.clientX * WIDTH / rect.width - drag.current.x,
            drag.current.offset[1] + event.clientY * WIDTH / rect.width - drag.current.y,
          ]);
        }}
        onPointerUp={(event) => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={() => { drag.current = null; }}
        onLostPointerCapture={() => { drag.current = null; }}
      >
        <title>Message locations</title>
        <defs><clipPath id={`${id}-clip`}><rect width={WIDTH} height={HEIGHT} /></clipPath></defs>
        <g clipPath={`url(#${id}-clip)`}>
          <path className="message-map-land" d={paths.countries} />
          <g className="message-map-graticule" aria-hidden="true">
            {labels.map((label) => label.axis === "lon"
              ? <line key={`lon-${label.text}`} x1={label.x} x2={label.x} y1={north} y2={south} />
              : <line key={`lat-${label.text}`} x1={west} x2={east} y1={label.y + 5} y2={label.y + 5} />)}
          </g>
          {paths.features.map(({ item, index, path }) => (
            <path
              key={index}
              className={`message-map-feature message-map-${item.properties.kind}`}
              d={path}
              tabIndex={0}
              role="img"
              aria-label={item.properties.label}
              onMouseEnter={() => setActive(item.properties.label)}
              onMouseLeave={() => setActive(undefined)}
              onFocus={() => setActive(item.properties.label)}
              onBlur={() => setActive(undefined)}
            ><title>{item.properties.label}</title></path>
          ))}
        </g>
        {labels.map((label) => <text key={`${label.axis}-${label.text}`} x={label.x} y={label.y} textAnchor={label.axis === "lon" ? "middle" : "start"} className="message-map-grid-label" aria-hidden="true">{label.text}</text>)}
      </svg>
      {active && <div className="message-map-tooltip" role="status">{active}</div>}
      <span id={`${id}-help`} className="sr-only">Drag or use arrow keys to pan. Plus and minus zoom. Home fits message locations. Focus a plotted location to read its label.</span>
    </div>
  );
}
