export type ActivityStatus = 'success' | 'error';

export interface Activity {
  id: number | string;
  created_at: string;
  action: string;
  status: ActivityStatus;
  message: string;
  contact_name?: string | null;
  user_name?: string | null;
  user_email?: string | null;
  subaccount_id?: string | null;
  subaccount_name?: string | null;
  details?: Record<string, unknown> | null;
}

// What the browser sees of a sub-account (never the token)
export interface SubaccountPublic {
  id: string;
  name: string;
  location_id: string;
  timezone: string;
  currency: string;
  invoice_live_mode: boolean;
  invoice_sender_name: string | null;
  notify_webhook_url: string | null;
  token_hint: string;
  webhook_key: string;
  voice_enabled: boolean;
  created_at: string;
  updated_at: string;
}
