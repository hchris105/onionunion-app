export enum UserStatus {
  PREORDER = 'preorder',
  TRIAL = 'trial',
  ACTIVE = 'active',
  REFUNDED = 'refunded',
  DISABLED = 'disabled',
  LOCKED = 'locked'
}

export interface Character {
  code: string;
  name: string;
  line: string; // e.g., "泪系", "光系"
  assigned_at?: string;
}

export interface User {
  handle: string;
  email?: string;
  status: UserStatus;
  roles: string[];
  must_change_password: boolean;
  
  // Trial specific
  trial_ask_limit?: number;
  trial_ask_used?: number;

  // Character specific (for Preorder/Active)
  character_code?: string;
  character_name?: string;
  character_line?: string;
  character?: Character; // Helper to group character data
}

export interface AuthResponse {
  ok: boolean;
  user?: User;
  need_password_change?: boolean;
  msg?: string;
}

export interface ChangePasswordResponse {
  ok: boolean;
  changed: boolean;
  rewarded: boolean;
  character?: Character;
}

export interface AskResponse {
  ok: boolean;
  answer?: string;
  status?: string;
  used_model?: string;
  trial_quota_exhausted?: boolean;
  error?: string;
}
