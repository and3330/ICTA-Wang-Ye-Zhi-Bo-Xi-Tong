import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AuditEventDto, ManagementCatalogDto, ManagementMeDto, ManagementOverviewDto, MemberDetailDto, MemberListItemDto, OrderDto, PaginatedDto, SubscriptionDto, SupportCaseDto } from "@shared/adminManagement";
import type { CourseMarketplaceManagementItemDto } from "@shared/courseMarketplace";

const base = "/api/management";
const json = <T,>(url: string) => fetch(url, { credentials: "include" }).then(async r => {
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()) || r.statusText}`);
  return r.json() as Promise<T>;
});
const path = (name: string, params: Record<string, string | number | undefined> = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => value !== undefined && value !== "" && search.set(key, String(value)));
  return `${base}/${name}${search.size ? `?${search}` : ""}`;
};
const mutation = (method: string, url: string, data?: unknown) => apiRequest(method, url, data).then(r => r.json());

export type ListFilters = {
  page: number;
  pageSize?: number;
  search?: string;
  status?: string;
  plan?: string;
  kind?: string;
  active?: string;
  role?: string;
  userId?: string;
  provider?: string;
  targetUserId?: string;
  action?: string;
  from?: string;
  to?: string;
};
export function useManagementMe() { const url=`${base}/me`; return useQuery({ queryKey: [base,url], queryFn: () => json<ManagementMeDto>(url) }); }
export function useManagementOverview(enabled: boolean) { const url=`${base}/overview`; return useQuery({ queryKey: [base,url], queryFn: () => json<ManagementOverviewDto>(url), enabled }); }
export function useManagementCatalog(enabled: boolean) { const url=`${base}/catalog`; return useQuery({ queryKey: [base,url], queryFn: () => json<ManagementCatalogDto>(url), enabled }); }
export function useMembers(filters: ListFilters, enabled: boolean) { const url = path("members", filters); return useQuery({ queryKey: [base,url], queryFn: () => json<PaginatedDto<MemberListItemDto>>(url), enabled }); }
export function useMember(id: string, enabled: boolean) { const url=`${base}/members/${id}`; return useQuery({ queryKey: [base,url], queryFn: () => json<MemberDetailDto>(url), enabled: enabled && !!id }); }
export function useAiLedger(id: string, filters: Pick<ListFilters, "page" | "pageSize">, enabled: boolean) {
  const url = path(`members/${id}/ai-ledger`, filters);
  return useQuery({ queryKey: [base,url], queryFn: () => json<PaginatedDto<import("@shared/adminManagement").AiLedgerEntryDto>>(url), enabled: enabled && !!id });
}
export function useSubscriptions(filters: ListFilters, enabled: boolean) { const url = path("subscriptions", filters); return useQuery({ queryKey: [base,url], queryFn: () => json<PaginatedDto<SubscriptionDto>>(url), enabled }); }
export function useOrders(filters: ListFilters, enabled: boolean) { const url = path("orders", filters); return useQuery({ queryKey: [base,url], queryFn: () => json<PaginatedDto<OrderDto>>(url), enabled }); }
export function useSupport(filters: ListFilters, enabled: boolean) { const url = path("support", filters); return useQuery({ queryKey: [base,url], queryFn: () => json<PaginatedDto<SupportCaseDto>>(url), enabled }); }
export function useAudit(filters: ListFilters, enabled: boolean) { const url = path("audit", filters); return useQuery({ queryKey: [base,url], queryFn: () => json<PaginatedDto<AuditEventDto>>(url), enabled }); }
export function useCourseMarketplaceQueue(enabled: boolean) {
  const url = `${base}/course-marketplace`;
  return useQuery<{ items: CourseMarketplaceManagementItemDto[] }>({
    queryKey: [base, url],
    queryFn: () => json<{ items: CourseMarketplaceManagementItemDto[] }>(url),
    enabled,
  });
}
export function useManagementAction() {
  return useMutation({ mutationFn: ({ method = "PATCH", url, data }: { method?: string; url: string; data?: unknown }) => mutation(method, url.startsWith("/") ? url : `${base}/${url}`, data), onSuccess: () => queryClient.invalidateQueries({ queryKey: [base] }) });
}
export const managementUrl = (suffix: string) => `${base}/${suffix}`;