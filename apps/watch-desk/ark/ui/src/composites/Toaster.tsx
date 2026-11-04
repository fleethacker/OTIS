/**
 * Toaster — daisyUI-themed sonner wrapper.
 *
 * Sonner is the framework default for transient notifications. This
 * wrapper sets sensible defaults (position, theme inheritance) so apps
 * can drop `<Toaster />` once near the shell root and `import { toast }
 * from '@defense-unicorns/ark-ui'` everywhere else.
 *
 * Theme inheritance: sonner reads `data-theme` from the document root
 * and switches between dark/light variants. Our wrapper passes
 * `theme="system"` so the toaster honors the daisyUI theme set on
 * `<html data-theme="...">` (since dim/night/dark/etc. are dark-scheme,
 * sonner picks dark; light themes pick light).
 */
import {
  Toaster as SonnerToaster,
  // Alias sonner's own props type so it doesn't collide with the local
  // ToasterProps name below.
  type ToasterProps as SonnerToasterProps,
} from "sonner";

export interface ToasterProps {
  position?:
    | "top-left"
    | "top-right"
    | "top-center"
    | "bottom-left"
    | "bottom-right"
    | "bottom-center";
  richColors?: boolean;
  closeButton?: boolean;
  duration?: number;
  /**
   * Escape hatch: any other sonner Toaster option (`hotkey`, `expand`,
   * `visibleToasts`, `gap`, `offset`, `toastOptions`, …). Spread LAST
   * onto the underlying `<Sonner>` so callers reach sonner's full
   * surface — and can override the composite's defaults — without the
   * wrapper enumerating every option.
   */
  sonnerProps?: Partial<SonnerToasterProps>;
}

/**
 * Toaster mounts the sonner notification surface. Place once at the
 * shell level (App.tsx or app-layout.tsx).
 *
 * Defaults match the wizard's pattern: bottom-right position, rich
 * colors enabled (success/error use semantic theme colors), 4s duration.
 */
export function Toaster({
  position = "bottom-right",
  richColors = true,
  closeButton = false,
  duration = 4000,
  sonnerProps,
}: ToasterProps): React.JSX.Element {
  return (
    <SonnerToaster
      position={position}
      richColors={richColors}
      closeButton={closeButton}
      duration={duration}
      theme="system"
      // Spread caller overrides LAST so they win over the defaults above
      // and expose every remaining sonner Toaster option.
      {...sonnerProps}
    />
  );
}

// The imperative toast API (toast.success / toast.error / etc.) is
// re-exported from ./toast.ts to keep this file component-only.
