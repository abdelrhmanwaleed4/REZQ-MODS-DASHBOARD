import * as db from "./db";

export const PERMISSIONS = [
  { id: "manageRanks", label: "Manage Ranks", description: "Edit rank permissions and assign or remove ranks for users." },
  { id: "manageUsers", label: "Manage Users", description: "Approve pending accounts and permanently ban non-admin users." },
  { id: "manageDiscord", label: "Manage Discord Bot", description: "Configure the protected bot token and status channel." },
  { id: "manageAttendance", label: "Manage Attendance", description: "View team check-in history and hours." },
  { id: "managePoints", label: "Manage Points", description: "Award task points and record corrections." },
  { id: "manageLeaves", label: "Manage Leave", description: "Review leave and daily excuse requests." },
  { id: "manageDiscipline", label: "Manage Discipline", description: "Issue and revoke team warnings." },
  { id: "createVoiceRooms", label: "Create Voice Rooms", description: "Create managed Discord voice channels." },
  { id: "deleteVoiceRooms", label: "Delete Voice Rooms", description: "Delete voice channels created by this portal." },
  { id: "manageVoiceRooms", label: "Manage Voice Rooms", description: "Rename, lock and adjust portal-managed voice rooms." },
  { id: "manageReports", label: "Manage Reports", description: "Review internal incident reports." },
  { id: "manageAcademy", label: "Manage Academy", description: "Create and manage moderator exam questions." },
  { id: "viewAudit", label: "View Audit Log", description: "Read sensitive operations audit trail." },
  { id: "viewReports", label: "View Reports", description: "View weekly and monthly team performance." },
  { id: "manageModeration", label: "Moderation Center", description: "Create moderation case records and review action history." },
  { id: "manageAutoMod", label: "AutoMod Rules", description: "Configure privacy-conscious Kick/Discord alert rules." },
  { id: "reviewAppeals", label: "Review Appeals", description: "Decide appeals without reviewing your own actions." },
  { id: "manageKnowledge", label: "Knowledge Base", description: "Publish internal moderation guides." },
  { id: "manageAnnouncements", label: "Announcements", description: "Post announcements to staff and review acknowledgements." },
  { id: "manageAutomations", label: "Automations", description: "Configure allowlisted notification automations." },
  { id: "manageBookmarks", label: "Stream Bookmarks", description: "Create important stream event markers." },
  { id: "manageRewards", label: "Kick Rewards", description: "Review channel reward redemptions when Kick authorization permits." },
] as const;

export type PermissionId = typeof PERMISSIONS[number]["id"];
export const PERMISSION_IDS = PERMISSIONS.map(permission => permission.id) as [PermissionId, ...PermissionId[]];

export function parsePermissions(value: string): PermissionId[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const allowed = new Set<string>(PERMISSION_IDS);
    return [...new Set(parsed.filter((entry): entry is PermissionId => typeof entry === "string" && allowed.has(entry)))];
  } catch {
    return [];
  }
}

export async function effectivePermissions(user: { id: number; role: string }): Promise<PermissionId[]> {
  if (user.role === "admin") return [...PERMISSION_IDS];
  const assigned = await db.getUserRanks(user.id);
  return [...new Set(assigned.flatMap(rank => parsePermissions(rank.permissions)))];
}

// Rank administrators may not edit, assign or remove a rank that grants a
// permission they don't personally have, even if the attempted edit removes it.
export function canManageDelegatedRank(
  managerPermissions: readonly PermissionId[],
  rankPermissions: readonly PermissionId[],
): boolean {
  const available = new Set(managerPermissions);
  return rankPermissions.every(permission => available.has(permission));
}
