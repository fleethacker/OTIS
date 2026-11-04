import { useIdentityState, useQuery } from "@defense-unicorns/ark-ui";
import { getIdentity } from "../gen/app/v1/app-AppService_connectquery";

// The app owns its generated RPC descriptor; Ark owns auth-session observation
// and query invalidation. Keep this local binding for app-specific identity UI.
export function useIdentity() {
  return useIdentityState(useQuery(getIdentity));
}
