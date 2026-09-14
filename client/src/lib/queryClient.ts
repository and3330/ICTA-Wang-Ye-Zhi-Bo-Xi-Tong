import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    if (res.status === 401 && window.location.pathname.startsWith("/admin/")) {
      window.location.href = "/admin";
      throw new Error("登入已過期，請重新登入");
    }
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

/**
 * API queries can contain the previous signed-in member's private state.
 * React Query intentionally uses an infinite stale time for this app, so an
 * auth boundary must cancel and remove those entries before another account
 * mounts. Public non-API data (for example the pricing-region lookup) can
 * remain cached.
 */
export async function clearAuthScopedQueryCache() {
  const isAuthScoped = (query: { queryKey: readonly unknown[] }) => {
    const root = query.queryKey[0];
    return typeof root === "string" && root.startsWith("/api/");
  };
  await queryClient.cancelQueries({ predicate: isAuthScoped });
  queryClient.removeQueries({ predicate: isAuthScoped });
}
