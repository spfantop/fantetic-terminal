export interface ConnectionInfo {
  id: number;
  name: string;
  type: 'SSH' | 'RDP' | 'VNC' | 'TELNET';
  host: string;
  port: number;
  username: string;
  auth_method: 'password' | 'key';
  proxy_id?: number | null;
  proxy_type?: 'proxy' | 'jump' | null;
  folder_id?: number | null;
  icon?: string | null;
  sort_order?: number;
  tag_ids?: number[];
  ssh_key_id?: number | null;
  created_at: number;
  updated_at: number;
  last_connected_at: number | null;
  notes?: string | null;
  vncPassword?: string;
  jump_chain?: number[] | null;
  effective_permission?: 'view' | 'connect' | 'manage';
}

export interface ConnectionFolderInfo {
  id: number;
  name: string;
  parent_id?: number | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}
