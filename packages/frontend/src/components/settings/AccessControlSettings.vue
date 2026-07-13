<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  accessControlApi,
  type AssetConnection,
  type AssetFolder,
  type ConnectionGroupGrant,
  type ConnectionPermission,
  type GroupMember,
  type GroupRole,
  type ManagedUser,
  type UserGroup,
  type UserStatus,
} from '../../services/accessControl.api';
import type { SystemRole } from '../../stores/auth.store';
import { useConfirmDialog } from '../../composables/useConfirmDialog';

const { t } = useI18n();
const { showConfirmDialog } = useConfirmDialog();
type AccessPane = 'users' | 'groups' | 'assets';
type UserActionMode = 'password' | 'delete';
const activePane = ref<AccessPane>('users');
const userSearch = ref('');
const connectionSearch = ref('');
const selectedConnectionIds = ref<number[]>([]);
const selectedGrantGroupIds = ref<number[]>([]);
const batchPermission = ref<ConnectionPermission>('view');
const users = ref<ManagedUser[]>([]);
const groups = ref<UserGroup[]>([]);
const connections = ref<AssetConnection[]>([]);
const folders = ref<AssetFolder[]>([]);
const selectedGroupId = ref<number | null>(null);
const members = ref<GroupMember[]>([]);
const connectionGrants = ref<ConnectionGroupGrant[]>([]);
const selectedConnectionId = ref<number | null>(null);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const success = ref('');

const newUser = ref<{ username: string; password: string; systemRole: SystemRole }>({
  username: '', password: '', systemRole: 'user',
});
const newGroup = ref({ name: '', description: '' });
const memberDraft = ref<{ userId: number | null; role: GroupRole }>({ userId: null, role: 'viewer' });
const grantDraft = ref<{ groupId: number | null; permission: ConnectionPermission }>({ groupId: null, permission: 'view' });
const resetPasswords = ref<Record<number, string>>({});
const transferTargets = ref<Record<number, number | undefined>>({});
const groupDraft = ref({ name: '', description: '' });
const userAction = ref<{ userId: number; mode: UserActionMode } | null>(null);

const selectedGroup = computed(() => groups.value.find(group => group.id === selectedGroupId.value) ?? null);
const memberUserIds = computed(() => new Set(members.value.map(member => member.userId)));
const availableMemberUsers = computed(() => users.value.filter(user => !memberUserIds.value.has(user.id)));
const grantedGroupIds = computed(() => new Set(connectionGrants.value.map(grant => grant.groupId)));
const availableGrantGroups = computed(() => groups.value.filter(group => !grantedGroupIds.value.has(group.id)));
const filteredUsers = computed(() => {
  const query = userSearch.value.trim().toLocaleLowerCase();
  return query ? users.value.filter(user => user.username.toLocaleLowerCase().includes(query)) : users.value;
});
const filteredConnections = computed(() => {
  const query = connectionSearch.value.trim().toLocaleLowerCase();
  return query ? connections.value.filter(connection =>
    [connection.name, connection.host, connection.type, folderPath(connection)].some(value => value.toLocaleLowerCase().includes(query)),
  ) : connections.value;
});
const actionUser = computed(() => users.value.find(user => user.id === userAction.value?.userId) ?? null);
const activeActionUserId = computed(() => userAction.value?.userId ?? -1);
const permissionDescriptions = computed(() => ([
  { permission: 'view' as const, icon: 'fa-eye', action: t('accessControl.permissionActions.view') },
  { permission: 'connect' as const, icon: 'fa-terminal', action: t('accessControl.permissionActions.connect') },
  { permission: 'manage' as const, icon: 'fa-pen-to-square', action: t('accessControl.permissionActions.manage') },
]));
const allFilteredConnectionsSelected = computed(() => (
  filteredConnections.value.length > 0
  && filteredConnections.value.every(connection => selectedConnectionIds.value.includes(connection.id))
));
const allGroupsSelected = computed(() => (
  groups.value.length > 0 && groups.value.every(group => selectedGrantGroupIds.value.includes(group.id))
));
const toggleAllFilteredConnections = () => {
  const filteredIdSet = new Set(filteredConnections.value.map(connection => connection.id));
  selectedConnectionIds.value = allFilteredConnectionsSelected.value
    ? selectedConnectionIds.value.filter(id => !filteredIdSet.has(id))
    : Array.from(new Set([...selectedConnectionIds.value, ...filteredIdSet]));
};
const toggleAllGroups = () => {
  selectedGrantGroupIds.value = allGroupsSelected.value ? [] : groups.value.map(group => group.id);
};
const folderPath = (connection: AssetConnection) => {
  if (!connection.folder_id) return t('accessControl.rootFolder');
  const byId = new Map(folders.value.map(folder => [folder.id, folder]));
  const names: string[] = [];
  let current = byId.get(connection.folder_id);
  while (current && names.length < folders.value.length) { names.unshift(current.name); current = current.parent_id ? byId.get(current.parent_id) : undefined; }
  return names.join(' / ') || t('accessControl.rootFolder');
};

const report = (message: string, isError = false) => {
  error.value = isError ? message : '';
  success.value = isError ? '' : message;
};
const errorMessage = (cause: unknown) => {
  const responseMessage = (cause as { response?: { data?: { code?: string; message?: string } } })?.response?.data;
  return responseMessage?.code || responseMessage?.message || (cause instanceof Error ? cause.message : t('accessControl.error'));
};

const loadMembers = async () => {
  if (!selectedGroupId.value) { members.value = []; return; }
  const group = groups.value.find(item => item.id === selectedGroupId.value);
  groupDraft.value = { name: group?.name ?? '', description: group?.description ?? '' };
  members.value = await accessControlApi.listMembers(selectedGroupId.value);
};

const loadConnectionGrants = async () => {
  if (!selectedConnectionId.value) { connectionGrants.value = []; return; }
  connectionGrants.value = await accessControlApi.listConnectionGrants(selectedConnectionId.value);
};

const load = async () => {
  loading.value = true;
  try {
    [users.value, groups.value, connections.value, folders.value] = await Promise.all([
      accessControlApi.listUsers(), accessControlApi.listGroups(), accessControlApi.listConnections(), accessControlApi.listFolders(),
    ]);
    if (!selectedGroupId.value || !groups.value.some(group => group.id === selectedGroupId.value)) {
      selectedGroupId.value = groups.value[0]?.id ?? null;
    }
    await loadMembers();
    if (!selectedConnectionId.value || !connections.value.some(connection => connection.id === selectedConnectionId.value)) {
      selectedConnectionId.value = connections.value[0]?.id ?? null;
    }
    await loadConnectionGrants();
  } catch (cause) { report(errorMessage(cause), true); }
  finally { loading.value = false; }
};

const createUser = async () => {
  if (!newUser.value.username.trim() || newUser.value.password.length < 12) {
    report(t('accessControl.passwordRequirement'), true); return;
  }
  saving.value = true;
  try {
    await accessControlApi.createUser({ ...newUser.value, username: newUser.value.username.trim() });
    newUser.value = { username: '', password: '', systemRole: 'user' };
    report(t('accessControl.userCreated'));
    await load();
  } catch (cause) { report(errorMessage(cause), true); }
  finally { saving.value = false; }
};

const updateUser = async (user: ManagedUser, field: 'systemRole' | 'status', value: SystemRole | UserStatus) => {
  try {
    await accessControlApi.updateUser(user.id, { [field]: value });
    report(t('accessControl.userUpdated'));
    await load();
  } catch (cause) { report(errorMessage(cause), true); await load(); }
};

const resetPassword = async (user: ManagedUser) => {
  const password = resetPasswords.value[user.id] ?? '';
  if (password.length < 12) { report(t('accessControl.passwordRequirement'), true); return; }
  try {
    await accessControlApi.resetUserPassword(user.id, password);
    resetPasswords.value[user.id] = '';
    userAction.value = null;
    report(t('accessControl.passwordReset'));
  } catch (cause) { report(errorMessage(cause), true); }
};

const deleteUser = async (user: ManagedUser) => {
  const transferToUserId = transferTargets.value[user.id];
  if (!transferToUserId) { report(t('accessControl.transferRequired'), true); return; }
  if (!await showConfirmDialog({ message: t('accessControl.confirmDeleteUser', { username: user.username }) })) return;
  try {
    await accessControlApi.deleteUser(user.id, transferToUserId);
    report(t('accessControl.userDeleted'));
    userAction.value = null;
    await load();
  } catch (cause) { report(errorMessage(cause), true); }
};

const resetActionUserPassword = () => {
  if (actionUser.value) void resetPassword(actionUser.value);
};

const deleteActionUser = () => {
  if (actionUser.value) void deleteUser(actionUser.value);
};

const openUserAction = (user: ManagedUser, mode: UserActionMode) => {
  userAction.value = userAction.value?.userId === user.id && userAction.value.mode === mode
    ? null
    : { userId: user.id, mode };
};

const createGroup = async () => {
  if (!newGroup.value.name.trim()) { report(t('accessControl.groupNameRequired'), true); return; }
  try {
    const group = await accessControlApi.createGroup({
      name: newGroup.value.name.trim(), description: newGroup.value.description.trim() || undefined,
    });
    newGroup.value = { name: '', description: '' };
    selectedGroupId.value = group.id;
    report(t('accessControl.groupCreated'));
    await load();
  } catch (cause) { report(errorMessage(cause), true); }
};

const deleteGroup = async () => {
  if (!selectedGroup.value || !await showConfirmDialog({ message: t('accessControl.confirmDeleteGroup', { name: selectedGroup.value.name }) })) return;
  try {
    await accessControlApi.deleteGroup(selectedGroup.value.id);
    report(t('accessControl.groupDeleted'));
    selectedGroupId.value = null;
    await load();
  } catch (cause) { report(errorMessage(cause), true); }
};

const updateGroup = async () => {
  if (!selectedGroup.value || !groupDraft.value.name.trim()) {
    report(t('accessControl.groupNameRequired'), true); return;
  }
  try {
    await accessControlApi.updateGroup(selectedGroup.value.id, {
      name: groupDraft.value.name.trim(),
      description: groupDraft.value.description.trim() || undefined,
    });
    report(t('accessControl.groupUpdated'));
    await load();
  } catch (cause) { report(errorMessage(cause), true); }
};

const saveMember = async () => {
  if (!selectedGroupId.value || !memberDraft.value.userId) return;
  try {
    await accessControlApi.saveMember(selectedGroupId.value, memberDraft.value.userId, memberDraft.value.role);
    memberDraft.value = { userId: null, role: 'viewer' };
    report(t('accessControl.memberSaved'));
    await loadMembers();
  } catch (cause) { report(errorMessage(cause), true); }
};

const updateMemberRole = async (member: GroupMember, role: GroupRole) => {
  try {
    await accessControlApi.saveMember(member.groupId, member.userId, role);
    report(t('accessControl.memberSaved'));
    await loadMembers();
  } catch (cause) { report(errorMessage(cause), true); await loadMembers(); }
};

const deleteMember = async (member: GroupMember) => {
  try {
    await accessControlApi.deleteMember(member.groupId, member.userId);
    report(t('accessControl.memberDeleted'));
    await loadMembers();
  } catch (cause) { report(errorMessage(cause), true); }
};

const saveGrant = async () => {
  if (!selectedConnectionId.value || !grantDraft.value.groupId) return;
  try {
    await accessControlApi.saveConnectionGrant(
      selectedConnectionId.value, grantDraft.value.groupId, grantDraft.value.permission,
    );
    grantDraft.value = { groupId: null, permission: 'view' };
    report(t('accessControl.grantSaved'));
    await loadConnectionGrants();
  } catch (cause) { report(errorMessage(cause), true); }
};

const updateGrant = async (grant: ConnectionGroupGrant, permission: ConnectionPermission) => {
  try {
    await accessControlApi.saveConnectionGrant(grant.connectionId, grant.groupId, permission);
    report(t('accessControl.grantSaved'));
    await loadConnectionGrants();
  } catch (cause) { report(errorMessage(cause), true); await loadConnectionGrants(); }
};

const deleteGrant = async (grant: ConnectionGroupGrant) => {
  try {
    await accessControlApi.deleteConnectionGrant(grant.connectionId, grant.groupId);
    report(t('accessControl.grantDeleted'));
    await loadConnectionGrants();
  } catch (cause) { report(errorMessage(cause), true); }
};

const saveGrantBatch = async () => {
  if (!selectedConnectionIds.value.length || !selectedGrantGroupIds.value.length) {
    report(t('accessControl.batchSelectionRequired'), true); return;
  }
  saving.value = true;
  try {
    const grants = await accessControlApi.saveConnectionGrants({
      connectionIds: selectedConnectionIds.value,
      groupIds: selectedGrantGroupIds.value,
      permission: batchPermission.value,
    });
    report(t('accessControl.batchSaved', { count: grants.length }));
    if (selectedConnectionId.value && selectedConnectionIds.value.includes(selectedConnectionId.value)) {
      await loadConnectionGrants();
    }
  } catch (cause) { report(errorMessage(cause), true); }
  finally { saving.value = false; }
};

onMounted(load);
</script>

<template>
  <section class="access-control space-y-6">
    <div class="access-summary">
      <button type="button" :class="{ active: activePane === 'users' }" @click="activePane = 'users'"><i class="fas fa-user-shield"></i><span>{{ t('accessControl.users') }}</span><strong>{{ users.length }}</strong></button>
      <button type="button" :class="{ active: activePane === 'groups' }" @click="activePane = 'groups'"><i class="fas fa-users"></i><span>{{ t('accessControl.groups') }}</span><strong>{{ groups.length }}</strong></button>
      <button type="button" :class="{ active: activePane === 'assets' }" @click="activePane = 'assets'"><i class="fas fa-server"></i><span>{{ t('accessControl.assetPermissions') }}</span><strong>{{ connections.length }}</strong></button>
    </div>
    <p v-if="error" role="alert" class="message error">{{ error }}</p>
    <p v-if="success" role="status" class="message success">{{ success }}</p>
    <p v-if="loading">{{ t('common.loading') }}</p>

    <div v-if="activePane === 'users'" class="card">
      <div class="card-heading"><h2>{{ t('accessControl.users') }}</h2><label class="search-field"><i class="fas fa-search"></i><input v-model="userSearch" :placeholder="t('accessControl.searchUsers', '搜索用户')"></label></div>
      <form class="form-grid" @submit.prevent="createUser">
        <input v-model="newUser.username" :placeholder="t('accessControl.username')" autocomplete="off">
        <input v-model="newUser.password" type="password" :placeholder="t('accessControl.initialPassword')" autocomplete="new-password">
        <select v-model="newUser.systemRole" :aria-label="t('accessControl.systemRole')">
          <option value="user">{{ t('accessControl.roles.user') }}</option><option value="auditor">{{ t('accessControl.roles.auditor') }}</option>
          <option value="admin">{{ t('accessControl.roles.admin') }}</option><option value="super_admin">{{ t('accessControl.roles.superAdmin') }}</option>
        </select>
        <button type="submit" :disabled="saving">{{ t('accessControl.createUser') }}</button>
      </form>
      <div class="table-wrap">
        <table><thead><tr><th>{{ t('accessControl.username') }}</th><th>{{ t('accessControl.systemRole') }}</th><th>{{ t('accessControl.status') }}</th><th>{{ t('common.actions') }}</th></tr></thead>
          <tbody><tr v-for="user in filteredUsers" :key="user.id">
            <td>{{ user.username }}</td>
            <td><select :value="user.systemRole" @change="updateUser(user, 'systemRole', ($event.target as HTMLSelectElement).value as SystemRole)"><option value="user">{{ t('accessControl.roles.user') }}</option><option value="auditor">{{ t('accessControl.roles.auditor') }}</option><option value="admin">{{ t('accessControl.roles.admin') }}</option><option value="super_admin">{{ t('accessControl.roles.superAdmin') }}</option></select></td>
            <td><select :value="user.status" @change="updateUser(user, 'status', ($event.target as HTMLSelectElement).value as UserStatus)"><option value="active">{{ t('accessControl.statuses.active') }}</option><option value="disabled">{{ t('accessControl.statuses.disabled') }}</option></select></td>
            <td><div class="row-actions"><button type="button" :class="{ active: userAction?.userId === user.id && userAction.mode === 'password' }" @click="openUserAction(user, 'password')"><i class="fas fa-key"></i>{{ t('accessControl.resetPassword') }}</button><button type="button" class="danger-outline" :class="{ active: userAction?.userId === user.id && userAction.mode === 'delete' }" @click="openUserAction(user, 'delete')"><i class="fas fa-trash"></i>{{ t('common.delete') }}</button></div></td>
          </tr><tr v-if="filteredUsers.length === 0"><td colspan="4" class="empty-state">{{ t('accessControl.noUsers', '没有匹配的用户') }}</td></tr></tbody>
        </table>
      </div>
      <div v-if="actionUser && userAction" class="user-action-modal" role="dialog" aria-modal="true" :aria-label="t('common.actions')" @click.self="userAction = null">
        <section class="user-action-panel user-action-dialog">
          <header><div><strong>{{ actionUser.username }}</strong><span>{{ userAction.mode === 'password' ? t('accessControl.resetPassword') : t('accessControl.deleteUser') }}</span></div><button type="button" class="icon-close" :aria-label="t('common.close')" @click="userAction = null"><i class="fas fa-xmark"></i></button></header>
          <form v-if="userAction.mode === 'password'" class="action-form" @submit.prevent="resetActionUserPassword"><input v-model="resetPasswords[activeActionUserId]" type="password" :placeholder="t('accessControl.newPassword')" autocomplete="new-password"><button type="submit"><i class="fas fa-key"></i>{{ t('accessControl.confirmResetPassword') }}</button></form>
          <form v-else class="action-form" @submit.prevent="deleteActionUser"><select v-model="transferTargets[activeActionUserId]" :aria-label="t('accessControl.transferTarget')"><option :value="undefined" disabled>{{ t('accessControl.transferTarget') }}</option><option v-for="target in users.filter(item => item.id !== activeActionUserId && item.status === 'active')" :key="target.id" :value="target.id">{{ target.username }}</option></select><button type="submit" class="danger"><i class="fas fa-trash"></i>{{ t('accessControl.confirmDeleteAndTransfer') }}</button></form>
        </section>
      </div>
    </div>

    <div v-if="activePane === 'groups'" class="card">
      <div class="card-heading"><h2>{{ t('accessControl.groups') }}</h2></div>
      <form class="form-grid" @submit.prevent="createGroup"><input v-model="newGroup.name" :placeholder="t('accessControl.groupName')"><input v-model="newGroup.description" :placeholder="t('accessControl.description')"><button type="submit">{{ t('accessControl.createGroup') }}</button></form>
      <div class="group-toolbar"><select v-model="selectedGroupId" @change="loadMembers"><option :value="null">{{ t('accessControl.selectGroup') }}</option><option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option></select><button v-if="selectedGroup" type="button" class="danger" @click="deleteGroup">{{ t('common.delete') }}</button></div>
      <template v-if="selectedGroup">
        <form class="form-grid group-profile" @submit.prevent="updateGroup"><input v-model="groupDraft.name" :placeholder="t('accessControl.groupName')"><input v-model="groupDraft.description" :placeholder="t('accessControl.description')"><button type="submit">{{ t('common.save') }}</button></form>
        <form class="form-grid" @submit.prevent="saveMember"><select v-model="memberDraft.userId"><option :value="null">{{ t('accessControl.selectUser') }}</option><option v-for="user in availableMemberUsers" :key="user.id" :value="user.id">{{ user.username }}</option></select><select v-model="memberDraft.role"><option value="viewer">{{ t('accessControl.groupRoles.viewer') }}</option><option value="operator">{{ t('accessControl.groupRoles.operator') }}</option><option value="admin">{{ t('accessControl.groupRoles.admin') }}</option><option value="owner">{{ t('accessControl.groupRoles.owner') }}</option></select><button type="submit">{{ t('accessControl.addMember') }}</button></form>
        <ul class="member-list"><li v-for="member in members" :key="member.userId"><span>{{ member.username }}</span><select :value="member.role" @change="updateMemberRole(member, ($event.target as HTMLSelectElement).value as GroupRole)"><option value="viewer">{{ t('accessControl.groupRoles.viewer') }}</option><option value="operator">{{ t('accessControl.groupRoles.operator') }}</option><option value="admin">{{ t('accessControl.groupRoles.admin') }}</option><option value="owner">{{ t('accessControl.groupRoles.owner') }}</option></select><button type="button" class="danger" @click="deleteMember(member)">{{ t('common.delete') }}</button></li></ul>
      </template>
    </div>

    <div v-if="activePane === 'assets'" class="card">
      <div class="card-heading"><h2>{{ t('accessControl.assetPermissions') }}</h2><label class="search-field"><i class="fas fa-search"></i><input v-model="connectionSearch" :placeholder="t('accessControl.searchAssets', '搜索资产')"></label></div>
      <div class="grant-matrix">
        <section>
          <div class="matrix-heading"><strong><span class="step-index">1</span>{{ t('accessControl.selectAssets', '选择资产') }} <small>{{ selectedConnectionIds.length }}</small></strong><button type="button" class="text-button" @click="toggleAllFilteredConnections">{{ allFilteredConnectionsSelected ? t('accessControl.clearSelection') : t('common.selectAll', '全选') }}</button></div>
          <label v-for="connection in filteredConnections" :key="connection.id" class="matrix-option"><input v-model="selectedConnectionIds" type="checkbox" :value="connection.id"><span>{{ connection.name }}<small><i class="fas fa-folder-tree"></i> {{ folderPath(connection) }} · {{ connection.host }}</small></span></label>
        </section>
        <section>
          <div class="matrix-heading"><strong><span class="step-index">2</span>{{ t('accessControl.selectGroups', '选择用户组') }} <small>{{ selectedGrantGroupIds.length }}</small></strong><button type="button" class="text-button" @click="toggleAllGroups">{{ allGroupsSelected ? t('accessControl.clearSelection') : t('common.selectAll', '全选') }}</button></div>
          <label v-for="group in groups" :key="group.id" class="matrix-option"><input v-model="selectedGrantGroupIds" type="checkbox" :value="group.id"><span>{{ group.name }}<small>{{ group.description }}</small></span></label>
        </section>
        <aside class="batch-panel">
          <strong><span class="step-index">3</span>{{ t('accessControl.permission') }}</strong>
          <div class="permission-selector">
            <button v-for="item in permissionDescriptions" :key="item.permission" type="button" :class="{ active: batchPermission === item.permission }" :aria-pressed="batchPermission === item.permission" @click="batchPermission = item.permission"><i :class="['fas', item.icon]"></i><span><b>{{ t(`accessControl.permissions.${item.permission}`) }}</b><small>{{ item.action }}</small></span></button>
          </div>
          <p>{{ t('accessControl.batchSummary', { assets: selectedConnectionIds.length, groups: selectedGrantGroupIds.length }) }}</p>
          <button type="button" :disabled="saving || !selectedConnectionIds.length || !selectedGrantGroupIds.length" @click="saveGrantBatch">{{ t('accessControl.applyBatch', '应用到所选项') }}</button>
        </aside>
      </div>
      <h3 class="detail-title">{{ t('accessControl.singleAssetDetail', '单个资产授权详情') }}</h3>
      <div class="group-toolbar">
        <select v-model="selectedConnectionId" :aria-label="t('accessControl.selectConnection')" @change="loadConnectionGrants">
          <option :value="null">{{ t('accessControl.selectConnection') }}</option>
          <option v-for="connection in filteredConnections" :key="connection.id" :value="connection.id">
            {{ folderPath(connection) }} / {{ connection.name }} · {{ connection.type }} · {{ connection.host }}
          </option>
        </select>
      </div>
      <template v-if="selectedConnectionId">
        <form class="form-grid" @submit.prevent="saveGrant">
          <select v-model="grantDraft.groupId" :aria-label="t('accessControl.selectGroup')">
            <option :value="null">{{ t('accessControl.selectGroup') }}</option>
            <option v-for="group in availableGrantGroups" :key="group.id" :value="group.id">{{ group.name }}</option>
          </select>
          <select v-model="grantDraft.permission" :aria-label="t('accessControl.permission')">
<option value="view">{{ t('accessControl.permissions.view') }}</option><option value="connect">{{ t('accessControl.permissions.connect') }}</option><option value="manage">{{ t('accessControl.permissions.manage') }}</option>
          </select>
          <button type="submit">{{ t('accessControl.addGrant') }}</button>
        </form>
        <ul class="member-list">
          <li v-for="grant in connectionGrants" :key="grant.groupId">
            <span>{{ grant.groupName }}</span>
            <select :value="grant.permission" @change="updateGrant(grant, ($event.target as HTMLSelectElement).value as ConnectionPermission)">
              <option value="view">{{ t('accessControl.permissions.view') }}</option><option value="connect">{{ t('accessControl.permissions.connect') }}</option><option value="manage">{{ t('accessControl.permissions.manage') }}</option>
            </select>
            <button type="button" class="danger" @click="deleteGrant(grant)">{{ t('common.delete') }}</button>
          </li>
        </ul>
      </template>
    </div>
  </section>
</template>

<style scoped>
.access-control button{background:var(--background);color:var(--foreground)}.access-control .form-grid button,.access-control .batch-panel button{background:var(--primary);color:var(--primary-foreground)}.access-control button.danger{background:var(--destructive);color:var(--destructive-foreground)}
.access-control{padding:0}.access-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.75rem}.access-summary button{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:.7rem;padding:.9rem 1rem;text-align:left;background:var(--background);color:var(--foreground)}.access-summary button i{color:var(--primary)}.access-summary button.active{border-color:var(--primary);box-shadow:inset 0 0 0 1px var(--primary)}.access-summary strong{font-size:1.15rem}.card{padding:1rem;border:1px solid var(--border);border-radius:.75rem;background:var(--card)}.card-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:1rem}.card-heading h2,h2{font-size:1.1rem;font-weight:600;margin:0}.card-heading p{margin:.25rem 0 0;color:var(--muted-foreground);font-size:.86rem}.search-field{display:flex;align-items:center;gap:.45rem;min-width:15rem;border:1px solid var(--border);border-radius:.5rem;padding:0 .65rem;background:var(--background)}.search-field input{border:0;min-width:0;width:100%;padding:.55rem 0}.search-field input:focus{outline:none}.form-grid{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:1rem}.form-grid>*{min-width:10rem}.form-grid input{flex:1}input,select,button{border:1px solid var(--border);border-radius:.4rem;padding:.5rem .65rem;background:var(--background);color:var(--foreground)}button{cursor:pointer;background:var(--primary);color:var(--primary-foreground)}button:disabled{opacity:.5}.danger{background:var(--destructive);color:var(--destructive-foreground)}.message{padding:.65rem;border-radius:.4rem}.error{color:var(--destructive);background:color-mix(in srgb,var(--destructive) 12%,transparent)}.success{color:var(--primary);background:color-mix(in srgb,var(--primary) 12%,transparent)}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:.6rem;border-bottom:1px solid var(--border);white-space:nowrap}.empty-state{text-align:center;color:var(--muted-foreground);padding:2rem}.inline,.group-toolbar{display:flex;gap:.4rem}.group-toolbar{margin-bottom:1rem}.group-toolbar select{flex:1}.row-actions{display:flex;gap:.4rem}.row-actions button{padding:.42rem .6rem}.row-actions button.active{border-color:var(--primary);color:var(--primary)}.danger-outline{color:var(--destructive)}.user-action-panel{margin-top:.8rem;padding:.85rem;border:1px solid var(--border);border-radius:.6rem;background:color-mix(in srgb,var(--muted) 35%,transparent)}.user-action-panel header{display:flex;align-items:center;justify-content:space-between;margin-bottom:.65rem}.user-action-panel header div{display:flex;align-items:center;gap:.6rem}.user-action-panel header span{color:var(--muted-foreground);font-size:.8rem}.icon-close{padding:.35rem .5rem}.action-form{display:grid;grid-template-columns:minmax(12rem,1fr) auto;gap:.5rem}.group-profile{padding:.8rem;border-radius:.6rem;background:color-mix(in srgb,var(--muted) 45%,transparent)}.member-list{display:grid;gap:.5rem}.member-list li{display:grid;grid-template-columns:1fr auto auto;gap:.5rem;align-items:center;padding:.5rem;border-bottom:1px solid var(--border)}.permission-guide{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.6rem;margin-bottom:1rem}.permission-guide article{display:flex;align-items:center;gap:.65rem;padding:.7rem;border:1px solid var(--border);border-radius:.55rem;background:var(--background)}.permission-guide article>i{width:1.6rem;text-align:center;color:var(--primary)}.permission-guide article div{display:grid;gap:.15rem}.permission-guide article span{color:var(--muted-foreground);font-size:.75rem;line-height:1.35}.grant-matrix{display:grid;grid-template-columns:minmax(12rem,1fr) minmax(12rem,1fr) minmax(13rem,.7fr);gap:.8rem;margin-bottom:1.5rem}.grant-matrix>section,.batch-panel{min-height:13rem;max-height:18rem;overflow:auto;padding:.75rem;border:1px solid var(--border);border-radius:.6rem;background:var(--background)}.matrix-heading{position:sticky;top:-.75rem;display:flex;align-items:center;justify-content:space-between;padding:.5rem 0;background:var(--background);z-index:1}.matrix-option{display:flex;align-items:center;gap:.55rem;padding:.5rem;border-radius:.4rem;cursor:pointer}.matrix-option:hover{background:var(--muted)}.matrix-option span{display:grid}.matrix-option small{color:var(--muted-foreground)}.text-button{padding:.25rem;border:0;background:transparent;color:var(--primary)}.batch-panel{display:flex;flex-direction:column;gap:.75rem;overflow:visible}.batch-panel p{margin:0;color:var(--muted-foreground)}.detail-title{margin:0 0 .75rem;font-size:.95rem}@media(max-width:900px){.grant-matrix,.permission-guide{grid-template-columns:1fr 1fr}.batch-panel{grid-column:1/-1;min-height:auto}}@media(max-width:760px){.access-summary,.grant-matrix,.permission-guide,.action-form{grid-template-columns:1fr}.batch-panel{grid-column:auto}.card-heading{flex-direction:column}.search-field{width:100%;min-width:0}.inline{min-width:24rem}}
.user-action-modal{position:fixed;inset:0;z-index:1250;display:grid;place-items:center;padding:1rem;background:rgba(0,0,0,.62)}.user-action-modal .user-action-dialog{width:min(34rem,100%);margin:0;padding:1rem;background:var(--card);box-shadow:0 20px 60px rgba(0,0,0,.38)}.matrix-heading strong,.batch-panel>strong{display:flex;align-items:center;gap:.45rem}.matrix-heading strong small{display:inline-grid;place-items:center;min-width:1.35rem;height:1.35rem;padding:0 .3rem;border-radius:999px;background:var(--muted);color:var(--muted-foreground);font-size:.68rem}.step-index{display:inline-grid;place-items:center;width:1.35rem;height:1.35rem;border:1px solid var(--border);border-radius:50%;background:var(--muted);color:var(--foreground);font-size:.72rem}.permission-selector{display:grid;gap:.45rem}.access-control .batch-panel .permission-selector button{display:grid;grid-template-columns:1.35rem minmax(0,1fr);align-items:center;gap:.55rem;width:100%;padding:.6rem;text-align:left;background:var(--background);color:var(--foreground);border-color:var(--border);box-shadow:none}.permission-selector button>i{color:var(--muted-foreground)}.permission-selector button span{display:grid;gap:.12rem}.permission-selector button b{font-size:.82rem}.permission-selector button small{color:var(--muted-foreground);font-size:.7rem;line-height:1.25}.permission-selector button:hover{border-color:color-mix(in srgb,var(--foreground) 28%,var(--border));background:var(--muted)}.permission-selector button.active{border-color:color-mix(in srgb,var(--foreground) 48%,var(--border));background:var(--accent);color:var(--accent-foreground);box-shadow:inset .18rem 0 var(--primary)}.permission-selector button.active>i{color:var(--foreground)}.matrix-option input{accent-color:var(--primary)}.matrix-option:has(input:checked){background:var(--accent);color:var(--accent-foreground)}@media(max-width:760px){.user-action-modal{place-items:end center;padding:.5rem}.user-action-modal .user-action-dialog{border-radius:.75rem}.row-actions button{font-size:.78rem}.permission-guide{display:none}}
</style>
