import { z } from "zod";

export const courseMarketplaceQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
}).strict();

export const courseMarketplaceOwnerMutationSchema = z.object({
  optedIn: z.boolean(),
}).strict();

export const courseMarketplaceReviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(1000).optional(),
  version: z.number().int().positive(),
}).strict().superRefine((value, ctx) => {
  if (value.action === "reject" && !value.reason) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "Rejection reason is required" });
  }
});

export type CourseMarketplaceQuery = z.infer<typeof courseMarketplaceQuerySchema>;
export type CourseMarketplaceOwnerMutation = z.infer<typeof courseMarketplaceOwnerMutationSchema>;
export type CourseMarketplaceReview = z.infer<typeof courseMarketplaceReviewSchema>;
export type CourseMarketplacePublicDto = {
  webinarId: string; title: string; summary: string; cover: string | null;
  ownerDisplayName: string; ownerCompany: string; registrationUrl: string; approvedAt: string;
};

export type CourseMarketplaceOwnerDto = {
  webinarId: string;
  optedIn: boolean;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  approvedTitle: string | null;
  approvedSummary: string | null;
  approvedCover: string | null;
  requestedAt: string | null;
  approvedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  version: number;
};

export type CourseMarketplaceManagementItemDto = CourseMarketplaceOwnerDto & {
  id: string;
  webinarTitle: string;
  ownerName: string;
  ownerCompany: string;
};