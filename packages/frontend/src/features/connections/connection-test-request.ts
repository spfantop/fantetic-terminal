export type ConnectionTestFormData = {
  type: 'SSH' | 'TELNET' | 'RDP' | 'VNC';
  host: string;
  port: number;
  username: string;
  auth_method: 'password' | 'key';
  password?: string;
  private_key?: string;
  passphrase?: string;
  proxy_id?: number | null;
  selected_ssh_key_id?: number | null;
};

export type ConnectionTestPayload = {
  type: ConnectionTestFormData['type'];
  host: string;
  port: number;
  username: string;
  auth_method: ConnectionTestFormData['auth_method'];
  password?: string;
  private_key?: string;
  passphrase?: string;
  proxy_id: number | null;
  ssh_key_id?: number;
};

export type ConnectionTestRequest = {
  endpoint: string;
  data: ConnectionTestPayload;
};

export const buildConnectionTestRequest = (
  formData: ConnectionTestFormData,
  savedConnectionId: number | null,
): ConnectionTestRequest => ({
  endpoint: savedConnectionId === null
    ? '/connections/test-unsaved'
    : `/connections/${savedConnectionId}/test`,
  data: {
    type: formData.type,
    host: formData.host.trim(),
    port: formData.port,
    username: formData.username.trim(),
    auth_method: formData.auth_method,
    password: formData.password || undefined,
    private_key: formData.private_key || undefined,
    passphrase: formData.passphrase || undefined,
    proxy_id: formData.proxy_id || null,
    ssh_key_id: formData.auth_method === 'key' && formData.selected_ssh_key_id
      ? formData.selected_ssh_key_id
      : undefined,
  },
});
