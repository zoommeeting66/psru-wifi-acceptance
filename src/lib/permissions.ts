import { UserRole } from "@prisma/client";

export type Permission =
  | "point:read"
  | "point:write"
  | "inspection:write"
  | "defect:open"
  | "defect:close"
  | "plan:write"
  | "report:export";

const MATRIX: Record<UserRole, Permission[]> = {
  FIELD: ["point:read", "inspection:write", "defect:open"],
  COMMITTEE: ["point:read", "defect:open", "defect:close", "plan:write", "report:export"],
  ADMIN: [
    "point:read",
    "point:write",
    "inspection:write",
    "defect:open",
    "defect:close",
    "plan:write",
    "report:export",
  ],
};

export function hasPermission(role: UserRole, perm: Permission): boolean {
  return MATRIX[role]?.includes(perm) ?? false;
}
