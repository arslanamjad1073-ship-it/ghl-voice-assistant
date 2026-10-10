'use client';
import { useCallback, useEffect, useState } from 'react';
import type { SubaccountPublic } from '@/lib/types';

const KEY = 'nova-subaccount';

export function readSelected() {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}
export function writeSelected(id: string) {
  try { localStorage.setItem(KEY, id); } catch { /* storage blocked */ }
}

// Loads sub-accounts and keeps the selected one in localStorage
export function useSubaccounts() {
  const [items, setItems] = useState<SubaccountPublic[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelectedState] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/subaccounts', { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not load sub-accounts');
      setItems(d.items);
      setCanManage(!!d.canManage);
      const saved = readSelected();
      const pick = d.items.find((s: SubaccountPublic) => s.id === saved) ? saved : d.items[0]?.id || '';
      setSelectedState(pick);
      if (pick) writeSelected(pick);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const setSelected = (id: string) => { setSelectedState(id); writeSelected(id); };
  return { items, canManage, loading, error, selected, setSelected, reload, current: items.find((s) => s.id === selected) };
}
