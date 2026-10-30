'use client';
import { createContext, useContext } from 'react';
import type { AccessInfo, Permission } from '@/lib/permissions';

// What the signed-in member may do, for showing / hiding buttons. The server checks every request again.
const Ctx = createContext<AccessInfo | null>(null);

export function AccessProvider({ value, children }: { value: AccessInfo; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAccess() {
  const a = useContext(Ctx);
  const can = (p: Permission) => !!a && (a.role === 'owner' || a.permissions.includes(p));
  return { ...(a || { orgId: '', orgName: '', role: 'user' as const, permissions: [], allSubaccounts: false }), can };
}
