export function calendarReturn(value: string | null): string {
  if (value === null || value === "") {
    return "/calendar";
  }
  try {
    const url = new URL(value, "https://watch.invalid");
    if (url.origin === "https://watch.invalid" && url.pathname === "/calendar") {
      return url.pathname + url.search;
    }
  } catch {
    /* Invalid return destinations fall back to Calendar. */
  }
  return "/calendar";
}

export function messageHref(id: string, returnTo: string) {
  return `/messages?${new URLSearchParams({ record: id, returnTo: calendarReturn(returnTo) })}`;
}
