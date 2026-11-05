import type { StationAssignment } from "./session";

export type StationDraft = Omit<StationAssignment, "revision" | "source">;
export const emptyStation: StationDraft = {
  shipName: "",
  commandIds: [],
  department: "",
  watchStation: "",
  responsibilityIds: [],
  includeUnassigned: false,
};
export function editableStation(
  station: StationAssignment | null | undefined
): StationDraft | null {
  if (station === null || station === undefined) {
    return null;
  }
  const { shipName, commandIds, department, watchStation, responsibilityIds, includeUnassigned } =
    station;
  return { shipName, commandIds, department, watchStation, responsibilityIds, includeUnassigned };
}
export function validStation(station: StationDraft | null) {
  return (
    station === null ||
    ([station.shipName, station.department, station.watchStation].every(
      (name) => name.trim() !== "" && name.length <= 100
    ) &&
      station.commandIds.length > 0 &&
      station.commandIds.length <= 32 &&
      station.commandIds.every(
        (id) => id.trim() !== "" && new TextEncoder().encode(id).length <= 256
      ) &&
      station.responsibilityIds.length > 0 &&
      station.responsibilityIds.length <= 32)
  );
}
