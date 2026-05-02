import { TablePickerLanding } from "@/components/landing/TablePickerLanding";

/**
 * Temporary landing for the soft-launch period: no physical QR codes have
 * been printed yet, so customers reach the site directly and choose their
 * table from a public picker. Two-step gate:
 *   1. Bar access code (server-side validated against BAR_ACCESS_CODE).
 *   2. Pick from the list of free tables.
 *
 * On success the backend mints a 12h table token and the picker stores it
 * + redirects to /mesa/:id?t=<token> — exactly the path the QR would use.
 */
export default function Home() {
  return <TablePickerLanding />;
}
