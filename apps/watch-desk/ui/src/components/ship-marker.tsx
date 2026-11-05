import { shipColor, shipKey, shipName } from "./ship-calendars";
import { ShipName } from "./ship-name";
import { ShipSymbol } from "./ship-symbol";

export function ShipMarker({
  unit,
  domain,
  affiliation,
}: {
  unit?: string;
  domain?: "unknown" | "surface" | "subsurface";
  affiliation?: "unknown" | "friend";
}) {
  const assigned = unit !== undefined && unit.trim() !== "";
  return (
    <span className="ship-identity">
      <span
        className="ship-marker"
        style={{ backgroundColor: shipColor(shipKey(unit)) }}
        aria-hidden="true"
      />
      {assigned && <ShipSymbol domain={domain} affiliation={affiliation} />}
      {assigned ? <ShipName name={shipName(unit)} /> : shipName(unit)}
    </span>
  );
}
