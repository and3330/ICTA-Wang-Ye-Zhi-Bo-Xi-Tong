import { useCallback } from "react";
import { useClerk } from "@clerk/react";
import { apiRequest, clearAuthScopedQueryCache } from "@/lib/queryClient";

/**
 * Ends both authentication layers. Google users have a Clerk session in
 * addition to the legacy SellCase session used by the existing API.
 */
export function useAdminLogout() {
  const { signOut } = useClerk();

  return useCallback(async () => {
    let legacyError: unknown;
    let clerkError: unknown;

    try {
      await apiRequest("POST", "/api/admin/logout", {});
    } catch (error) {
      legacyError = error;
    }
    try {
      // This is also a safe no-op for members who used username/password and
      // therefore have no active Clerk session.
      await signOut();
    } catch (error) {
      clerkError = error;
    }

    await clearAuthScopedQueryCache();
    if (legacyError || clerkError) {
      throw legacyError || clerkError;
    }
  }, [signOut]);
}