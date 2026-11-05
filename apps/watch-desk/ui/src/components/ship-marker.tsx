import { shipColor, shipKey, shipName } from "./ship-calendars";
import { ShipName } from "./ship-name";
import { ShipSymbol } from "./ship-symbol";

export function ShipMarker({ unit }: { unit?: string }) {
  const assigned = unit !== undefined && unit.trim() !== "";
  return (
    <span className="ship-identity">
      <span
        className="ship-marker"
        style={{ backgroundColor: shipColor(shipKey(unit)) }}
        aria-hidden="true"
      />
      {assigned && <ShipSymbol />}
      {assigned ? <ShipName name={shipName(unit)} /> : shipName(unit)}
    </span>
  );
}
