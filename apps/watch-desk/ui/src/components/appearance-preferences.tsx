import { useId } from "react";
import { isAppearanceStyle, useAppTheme } from "../theme";
import { SelectInput } from "./ui";

export function AppearancePreferences() {
  const { style, selectStyle } = useAppTheme();
  const description = useId();
  return (
    <section className="appearance-preferences" aria-label="Appearance">
      <label>
        Interface style (this browser)
        <SelectInput
          value={style}
          aria-describedby={description}
          onChange={(event) => {
            if (isAppearanceStyle(event.target.value)) {
              selectStyle(event.target.value);
            }
          }}
        >
          <option value="maritime">Maritime</option>
          <option value="windows">Windows</option>
        </SelectInput>
      </label>
      <p id={description}>
        Applies immediately in this browser. Use the header appearance button for light or dark.
      </p>
    </section>
  );
}
