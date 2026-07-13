<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  accessControlApi,
  type GroupMember,
  type GroupRole,
  type ManagedUser,
  type UserGroup,
  type UserStatus,
} from '../../services/accessControl.api';
import type { SystemRole } from '../../stores/auth.store';

const { t } = useI18n();
const users = ref<ManagedUser[]>([]);
const groups = ref<UserGroup[]>([]);
const selectedGroupId = ref<number | null>(null);
const members = ref<GroupMember[]>([]);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const success = ref('');

const newUser = ref<{ username: string; password: string; systemRole: SystemRole }>({
  username: '', password: '', systemRole: 'user',
});
const newGroup = ref({ name: '', description: '' });
const memberDraft = ref<{ userId: number | null; role: GroupRole }>({ userId: null, role: 'viewer' });
const resetPasswords = ref<Record<number, string>>({});
const transferTargets = ref<Record<number, number | null>>({});

const selectedGroup = computed(() => groups.value.find(group => group.id === selectedGroupId.value) ?? null);
const memberUserIds = computed(() => new Set(members.value.map(member => member.userId)));
const availableMemberUsers = computed(() => users.value.filter(user => !memberUserIds.value.has(user.id)));

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
  members.value = await accessControlApi.listMembers(selectedGroupId.value);
};

const load = async () => {
  loading.value = true;
  try {
    [users.value, groups.value] = await Promise.all([accessControlApi.listUsers(), accessControlApi.listGroups()]);
    if (!selectedGroupId.value || !groups.value.some(group => group.id === selectedGroupId.value)) {
      selectedGroupId.value = groups.value[0]?.id ?? null;
    }
    await loadMembers();
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
    report(t('accessControl.passwordReset'));
  } catch (cause) { report(errorMessage(cause), true); }
};

const deleteUser = async (user: ManagedUser) => {
  const transferToUserId = transferTargets.value[user.id];
  if (!transferToUserId) { report(t('accessControl.transferRequired'), true); return; }
  if (!window.confirm(t('accessControl.confirmDeleteUser', { username: user.username }))) return;
  try {
    await accessControlApi.deleteUser(user.id, transferToUserId);
    report(t('accessControl.userDeleted'));
    await load();
  } catch (cause) { report(errorMessage(cause), true); }
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
  if (!selectedGroup.value || !window.confirm(t('accessControl.confirmDeleteGroup', { name: selectedGroup.value.name }))) return;
  try {
    await accessControlApi.deleteGroup(selectedGroup.value.id);
    report(t('accessControl.groupDeleted'));
    selectedGroupId.value = null;
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

onMounted(load);
</script>

<template>
  <section class="access-control space-y-6">
    <p v-if="error" role="alert" class="message error">{{ error }}</p>
    <p v-if="success" role="status" class="message success">{{ success }}</p>
    <p v-if="loading">{{ t('common.loading') }}</p>

    <div class="card">
      <h2>{{ t('accessControl.users') }}</h2>
      <form class="form-grid" @submit.prevent="createUser">
        <input v-model="newUser.username" :placeholder="t('accessControl.username')" autocomplete="off">
        <input v-model="newUser.password" type="password" :placeholder="t('accessControl.initialPassword')" autocomplete="new-password">
        <select v-model="newUser.systemRole" :aria-label="t('accessControl.systemRole')">
          <option value="user">user</option><option value="auditor">auditor</option>
          <option value="admin">admin</option><option value="super_admin">super_admin</option>
        </select>
        <button type="submit" :disabled="saving">{{ t('accessControl.createUser') }}</button>
      </form>
      <div class="table-wrap">
        <table><thead><tr><th>{{ t('accessControl.username') }}</th><th>{{ t('accessControl.systemRole') }}</th><th>{{ t('accessControl.status') }}</th><th>{{ t('accessControl.password') }}</th><th>{{ t('common.actions') }}</th></tr></thead>
          <tbody><tr v-for="user in users" :key="user.id">
            <td>{{ user.username }}</td>
            <td><select :value="user.systemRole" @change="updateUser(user, 'systemRole', ($event.target as HTMLSelectElement).value as SystemRole)"><option value="user">user</option><option value="auditor">auditor</option><option value="admin">admin</option><option value="super_admin">super_admin</option></select></td>
            <td><select :value="user.status" @change="updateUser(user, 'status', ($event.target as HTMLSelectElement).value as UserStatus)"><option value="active">active</option><option value="disabled">disabled</option></select></td>
            <td><div class="inline"><input v-model="resetPasswords[user.id]" type="password" autocomplete="new-password"><button type="button" @click="resetPassword(user)">{{ t('accessControl.reset') }}</button></div></td>
            <td><div class="inline"><select v-model="transferTargets[user.id]" :aria-label="t('accessControl.transferTarget')"><option :value="null">{{ t('accessControl.transferTarget') }}</option><option v-for="target in users.filter(item => item.id !== user.id && item.status === 'active')" :key="target.id" :value="target.id">{{ target.username }}</option></select><button type="button" class="danger" @click="deleteUser(user)">{{ t('common.delete') }}</button></div></td>
          </tr></tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h2>{{ t('accessControl.groups') }}</h2>
      <form class="form-grid" @submit.prevent="createGroup"><input v-model="newGroup.name" :placeholder="t('accessControl.groupName')"><input v-model="newGroup.description" :placeholder="t('accessControl.description')"><button type="submit">{{ t('accessControl.createGroup') }}</button></form>
      <div class="group-toolbar"><select v-model="selectedGroupId" @change="loadMembers"><option :value="null">{{ t('accessControl.selectGroup') }}</option><option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option></select><button v-if="selectedGroup" type="button" class="danger" @click="deleteGroup">{{ t('common.delete') }}</button></div>
      <template v-if="selectedGroup">
        <form class="form-grid" @submit.prevent="saveMember"><select v-model="memberDraft.userId"><option :value="null">{{ t('accessControl.selectUser') }}</option><option v-for="user in availableMemberUsers" :key="user.id" :value="user.id">{{ user.username }}</option></select><select v-model="memberDraft.role"><option value="viewer">viewer</option><option value="operator">operator</option><option value="admin">admin</option><option value="owner">owner</option></select><button type="submit">{{ t('accessControl.addMember') }}</button></form>
        <ul class="member-list"><li v-for="member in members" :key="member.userId"><span>{{ member.username }}</span><select :value="member.role" @change="updateMemberRole(member, ($event.target as HTMLSelectElement).value as GroupRole)"><option value="viewer">viewer</option><option value="operator">operator</option><option value="admin">admin</option><option value="owner">owner</option></select><button type="button" class="danger" @click="deleteMember(member)">{{ t('common.delete') }}</button></li></ul>
      </template>
    </div>
  </section>
</template>

<style scoped>
.access-control{padding:1rem}.card{padding:1rem;border:1px solid var(--border);border-radius:.75rem;background:var(--card)}h2{font-size:1.1rem;font-weight:600;margin-bottom:1rem}.form-grid{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:1rem}.form-grid>*{min-width:10rem}.form-grid input{flex:1}input,select,button{border:1px solid var(--border);border-radius:.4rem;padding:.5rem .65rem;background:var(--background);color:var(--foreground)}button{cursor:pointer;background:var(--primary);color:var(--primary-foreground)}button:disabled{opacity:.5}.danger{background:var(--destructive);color:var(--destructive-foreground)}.message{padding:.65rem;border-radius:.4rem}.error{color:var(--destructive);background:color-mix(in srgb,var(--destructive) 12%,transparent)}.success{color:var(--primary);background:color-mix(in srgb,var(--primary) 12%,transparent)}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:.5rem;border-bottom:1px solid var(--border);white-space:nowrap}.inline,.group-toolbar{display:flex;gap:.4rem}.group-toolbar{margin-bottom:1rem}.member-list{display:grid;gap:.5rem}.member-list li{display:grid;grid-template-columns:1fr auto auto;gap:.5rem;align-items:center;padding:.5rem;border-bottom:1px solid var(--border)}
</style>
