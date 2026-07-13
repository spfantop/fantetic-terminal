import apiClient from '../utils/apiClient';
import type { SystemRole } from '../stores/auth.store';

export type UserStatus = 'active' | 'disabled';
export type GroupRole = 'owner' | 'admin' | 'operator' | 'viewer';

export interface ManagedUser {
  id: number;
  username: string;
  systemRole: SystemRole;
  status: UserStatus;
}

export interface UserGroup {
  id: number;
  name: string;
  description?: string;
  createdBy: number;
  memberRole: GroupRole | null;
}

export interface GroupMember {
  groupId: number;
  userId: number;
  username: string;
  role: GroupRole;
}

export type ConnectionPermission = 'view' | 'connect' | 'manage';
export interface AssetConnection { id: number; name: string; host: string; type: string }
export interface ConnectionGroupGrant {
  connectionId: number;
  groupId: number;
  groupName: string;
  permission: ConnectionPermission;
}

const base = '/access-control';

export const accessControlApi = {
  async listUsers(): Promise<ManagedUser[]> {
    return (await apiClient.get<ManagedUser[]>(`${base}/users`)).data;
  },
  async createUser(input: { username: string; password: string; systemRole: SystemRole }): Promise<ManagedUser> {
    return (await apiClient.post<ManagedUser>(`${base}/users`, input)).data;
  },
  async updateUser(userId: number, input: { systemRole?: SystemRole; status?: UserStatus }): Promise<ManagedUser> {
    return (await apiClient.patch<ManagedUser>(`${base}/users/${userId}`, input)).data;
  },
  async resetUserPassword(userId: number, password: string): Promise<void> {
    await apiClient.put(`${base}/users/${userId}/password`, { password });
  },
  async deleteUser(userId: number, transferToUserId: number): Promise<void> {
    await apiClient.delete(`${base}/users/${userId}`, { params: { transferToUserId } });
  },
  async listGroups(): Promise<UserGroup[]> {
    return (await apiClient.get<UserGroup[]>(`${base}/groups`)).data;
  },
  async createGroup(input: { name: string; description?: string }): Promise<UserGroup> {
    return (await apiClient.post<UserGroup>(`${base}/groups`, input)).data;
  },
  async updateGroup(groupId: number, input: { name: string; description?: string }): Promise<UserGroup> {
    return (await apiClient.patch<UserGroup>(`${base}/groups/${groupId}`, input)).data;
  },
  async deleteGroup(groupId: number): Promise<void> {
    await apiClient.delete(`${base}/groups/${groupId}`);
  },
  async listMembers(groupId: number): Promise<GroupMember[]> {
    return (await apiClient.get<GroupMember[]>(`${base}/groups/${groupId}/members`)).data;
  },
  async saveMember(groupId: number, userId: number, role: GroupRole): Promise<GroupMember> {
    return (await apiClient.put<GroupMember>(`${base}/groups/${groupId}/members/${userId}`, { role })).data;
  },
  async deleteMember(groupId: number, userId: number): Promise<void> {
    await apiClient.delete(`${base}/groups/${groupId}/members/${userId}`);
  },
  async listConnections(): Promise<AssetConnection[]> {
    return (await apiClient.get<AssetConnection[]>('/connections')).data;
  },
  async listConnectionGrants(connectionId: number): Promise<ConnectionGroupGrant[]> {
    return (await apiClient.get<ConnectionGroupGrant[]>(`${base}/connections/${connectionId}/groups`)).data;
  },
  async saveConnectionGrant(connectionId: number, groupId: number, permission: ConnectionPermission): Promise<ConnectionGroupGrant> {
    return (await apiClient.put<ConnectionGroupGrant>(`${base}/connections/${connectionId}/groups/${groupId}`, { permission })).data;
  },
  async deleteConnectionGrant(connectionId: number, groupId: number): Promise<void> {
    await apiClient.delete(`${base}/connections/${connectionId}/groups/${groupId}`);
  },
};
