import { shipColor, shipKey, shipName } from "./ship-calendars";

export function ShipMarker({ unit }: { unit?: string }) {
  return (
    <span className="ship-identity">
      <span
        className="ship-marker"
        style={{ backgroundColor: shipColor(shipKey(unit)) }}
        aria-hidden="true"
      />
      {shipName(unit)}
    </span>
  );
}
