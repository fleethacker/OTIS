/**
 * `toast` — imperative notification API. Re-exported from sonner so
 * apps don't need to import it directly. Mount `<Toaster />` once at
 * the shell level (see ./Toaster.tsx) for these calls to render.
 *
 *   import { toast } from '@defense-unicorns/ark-ui'
 *   toast.success('Saved')
 *   toast.error('Could not save', { description: 'Network error' })
 *   toast.promise(fetch(...), { loading: 'Saving…', success: 'Saved', error: 'Failed' })
 *
 * This file is split from Toaster.tsx so react-refresh's
 * "only-export-components" rule stays satisfied — Toaster.tsx exports a
 * component; this exports a function.
 */
export { toast } from "sonner";
