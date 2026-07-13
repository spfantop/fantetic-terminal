export type SystemRole = 'super_admin' | 'admin' | 'user' | 'auditor';
export type GroupRole = 'owner' | 'admin' | 'operator' | 'viewer';
export type ConnectionPermission = 'none' | 'view' | 'connect' | 'manage';

export type ConnectionGrant = {
  groupRole: GroupRole;
  permission: Exclude<ConnectionPermission, 'none'>;
};

type ConnectionAccessContext = {
  userId: number;
  systemRole: SystemRole;
  ownerUserId: number | null;
  grants: ConnectionGrant[];
};

const PERMISSION_LEVEL: Record<ConnectionPermission, number> = {
  none: 0,
  view: 1,
  connect: 2,
  manage: 3,
};

const GROUP_ROLE_LIMIT: Record<GroupRole, Exclude<ConnectionPermission, 'none'>> = {
  viewer: 'view',
  operator: 'connect',
  admin: 'manage',
  owner: 'manage',
};

// SQL 列表投影与运行时授权规则同处一处维护，避免 Repository 复制角色上限规则后发生漂移。
export const CONNECTION_PERMISSION_LEVEL_SQL = `CASE
  WHEN membership.role = 'viewer' THEN 1
  WHEN membership.role = 'operator' AND permission.permission IN ('connect', 'manage') THEN 2
  WHEN membership.role IN ('admin', 'owner') AND permission.permission = 'manage' THEN 3
  WHEN permission.permission = 'connect' THEN 2
  ELSE 1
END`;

const permissionAtLevel = (level: number): ConnectionPermission => (
  (Object.entries(PERMISSION_LEVEL).find(([, value]) => value === level)?.[0]
    ?? 'none') as ConnectionPermission
);

export const resolveConnectionPermission = ({
  userId,
  systemRole,
  ownerUserId,
  grants,
}: ConnectionAccessContext): ConnectionPermission => {
  if (systemRole === 'super_admin' || systemRole === 'admin' || ownerUserId === userId) {
    return 'manage';
  }

  let effectiveLevel = systemRole === 'auditor' ? PERMISSION_LEVEL.view : PERMISSION_LEVEL.none;

  for (const grant of grants) {
    const roleLimit = GROUP_ROLE_LIMIT[grant.groupRole];
    const grantLevel = Math.min(PERMISSION_LEVEL[grant.permission], PERMISSION_LEVEL[roleLimit]);
    effectiveLevel = Math.max(effectiveLevel, grantLevel);
  }

  return permissionAtLevel(effectiveLevel);
};

export const hasConnectionPermission = (
  actual: ConnectionPermission,
  required: Exclude<ConnectionPermission, 'none'>,
): boolean => PERMISSION_LEVEL[actual] >= PERMISSION_LEVEL[required];
