import type { Timestamp } from "@bufbuild/protobuf/wkt";
export function utc(value?: Timestamp) {
  return value
    ? new Date(Number(value.seconds) * 1000)
        .toISOString()
        .replace("T", " ")
        .replace(/:00\.\d{3}Z$/, " UTC")
    : "Unavailable";
}
export function recordStatus(value: string) {
  return (
    (
      { parsed: "Parsed", updated: "Updated", needs_review: "Needs review" } as Record<
        string,
        string
      >
    )[value] ?? "Status unavailable"
  );
}
