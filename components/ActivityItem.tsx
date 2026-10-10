import type { Activity } from '@/lib/types';
import {
  IconTag, IconUserEdit, IconBriefcase, IconCalendar, IconNote, IconTask, IconChat, IconMail,
  IconReceipt, IconBell, IconAlert, IconSparkle, IconSend
} from '@/components/Icons';

const ICONS: Record<string, typeof IconTag> = {
  add_tag: IconTag, remove_tag: IconTag,
  update_contact_field: IconUserEdit,
  create_opportunity: IconBriefcase, move_opportunity: IconBriefcase, update_opportunity: IconBriefcase,
  book_appointment: IconCalendar, reschedule_appointment: IconCalendar, cancel_appointment: IconCalendar,
  add_note: IconNote, add_task: IconTask,
  send_sms: IconChat, send_email: IconMail,
  create_invoice: IconReceipt, notify_team_member: IconBell, send_followup: IconSend
};

// Highlights the quoted names in a message: Tag "VIP" added to contact "John"
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/("[^"]+")/g);
  return (
    <>
      {parts.map((p, i) =>
        /^"[^"]+"$/.test(p) ? <span key={i} className="font-semibold text-cyan">{p.slice(1, -1)}</span> : <span key={i}>{p}</span>
      )}
    </>
  );
}

export function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function relative(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' }) + ', ' + timeOf(iso);
}

export default function ActivityItem({
  item, meta = true, fresh = false, when = 'relative'
}: { item: Activity; meta?: boolean; fresh?: boolean; when?: 'relative' | 'time' }) {
  const failed = item.status === 'error';
  const Icon = failed ? IconAlert : ICONS[item.action] || IconSparkle;
  return (
    <li className={`flex gap-3 rounded-2xl bg-card p-3.5 ${fresh ? 'activity-in' : ''}`}>
      <span className={`mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full ${failed ? 'bg-bad/15 text-bad' : 'bg-cyan/12 text-cyan'}`}>
        <Icon size={19} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-[14.5px] leading-snug ${failed ? 'text-bad' : 'text-fg'}`}>
          <Highlighted text={item.message} />
        </p>
        <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted">
          <time dateTime={item.created_at}>{when === 'time' ? timeOf(item.created_at) : relative(item.created_at)}</time>
          {meta && item.user_name && <span>· {item.user_name}</span>}
          {meta && item.subaccount_name && <span className="truncate">· {item.subaccount_name}</span>}
        </p>
      </div>
    </li>
  );
}
