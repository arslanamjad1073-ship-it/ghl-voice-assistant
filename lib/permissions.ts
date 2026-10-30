// Shared by the server checks and the browser (which only uses them to hide what a member cannot use)

export type Role = 'owner' | 'admin' | 'user';

export const PERMISSIONS = ['manage_subaccounts', 'manage_ai', 'view_usage', 'manage_branding', 'manage_team'] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_INFO: Record<Permission, { label: string; hint: string }> = {
  manage_subaccounts: { label: 'Sub-accounts', hint: 'Add, edit and remove sub-accounts, set up message alerts' },
  manage_ai: { label: 'AI keys', hint: 'Add and change the AI provider and API key' },
  view_usage: { label: 'AI usage & cost', hint: 'See token usage and spend' },
  manage_branding: { label: 'Email branding', hint: 'Edit email branding of the sub-accounts they can access' },
  manage_team: { label: 'Team', hint: 'Invite and manage users (not admins), give only access they have themselves' }
};

// Starting point when inviting; the owner can change every switch
export const DEFAULT_PERMISSIONS: Record<'admin' | 'user', Permission[]> = {
  admin: ['manage_branding', 'manage_team'],
  user: []
};

export const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', admin: 'Admin', user: 'User' };

export interface AccessInfo {
  orgId: string;
  orgName: string;
  role: Role;
  permissions: Permission[];
  allSubaccounts: boolean;
}
