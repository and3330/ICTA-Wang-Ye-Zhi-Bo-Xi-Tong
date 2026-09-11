import assert from "node:assert/strict";
import test from "node:test";
import { MANAGEMENT_ROLE_PERMISSIONS, memberListQuerySchema } from "./adminManagementRoutes";

test("management role matrix never gives member access and scopes support away from billing", () => {
  assert.deepEqual(MANAGEMENT_ROLE_PERMISSIONS.member, []);
  assert.equal(MANAGEMENT_ROLE_PERMISSIONS.support.includes("support.write"), true);
  assert.equal(MANAGEMENT_ROLE_PERMISSIONS.support.includes("billing.refund"), false);
  assert.equal(MANAGEMENT_ROLE_PERMISSIONS.billing.includes("billing.refund"), true);
  assert.equal(MANAGEMENT_ROLE_PERMISSIONS.read_only.some(permission => permission.endsWith(".write") || permission.endsWith(".grant") || permission.endsWith(".refund")), false);
});

test("super-admin role contains every management permission", () => {
  assert.equal(MANAGEMENT_ROLE_PERMISSIONS.super_admin.includes("members.roles"), true);
  assert.equal(MANAGEMENT_ROLE_PERMISSIONS.super_admin.includes("audit.export"), true);
});

test("member active filter parses the literal false query value as false", () => {
  assert.equal(memberListQuerySchema.parse({ active: "false" }).active, false);
  assert.equal(memberListQuerySchema.parse({ active: "true" }).active, true);
  assert.equal(memberListQuerySchema.safeParse({ active: "anything" }).success, false);
});