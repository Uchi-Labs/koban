/**
 * `unstable_dynamicOnHover` upgrades a Link's prefetch from the loading-shell
 * level to the full page payload when the pointer enters it. Next 16.2 ships the
 * prop on the runtime Link (next/dist/client/app-dir/link.js reads it and calls
 * onNavigationIntent with it) and declares it on the app-dir prop type, but
 * `next/link` re-exports the shared type from next/dist/client/link.d.ts, which
 * does not carry it. This augmentation closes that gap.
 *
 * It is gated at runtime by `experimental.dynamicOnHover` in next.config.ts.
 * Delete this file when Next promotes the prop onto the public Link types.
 */
import "next/link";

declare module "next/link" {
  interface LinkProps {
    unstable_dynamicOnHover?: boolean;
  }
}
