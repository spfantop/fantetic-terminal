export type EffectiveConnectionPermission = 'view' | 'connect' | 'manage';

type PermissionAwareConnection = {
  effective_permission?: EffectiveConnectionPermission;
};

const PERMISSION_LEVEL: Record<EffectiveConnectionPermission, number> = {
  view: 1,
  connect: 2,
  manage: 3,
};

export const normalizeConnectionPermission = (
  permission: EffectiveConnectionPermission | undefined,
): EffectiveConnectionPermission => permission ?? 'view';

export const canConnectConnection = (connection: PermissionAwareConnection): boolean => (
  PERMISSION_LEVEL[normalizeConnectionPermission(connection.effective_permission)] >= PERMISSION_LEVEL.connect
);

export const canManageConnection = (connection: PermissionAwareConnection): boolean => (
  PERMISSION_LEVEL[normalizeConnectionPermission(connection.effective_permission)] >= PERMISSION_LEVEL.manage
);
