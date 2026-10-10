// Stroke icons (24px grid, currentColor)
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const make = (paths: React.ReactNode) =>
  function Icon({ size = 20, ...rest }: P) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
        {paths}
      </svg>
    );
  };

export const IconHome = make(<><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" /></>);
export const IconMic = make(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>);
export const IconMicOff = make(<><path d="M15 9.3V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5M5.5 11a6.5 6.5 0 0 0 10.4 5.2M18.5 11a6.4 6.4 0 0 1-.4 2.2M12 17.5V21M3 3l18 18" /></>);
export const IconClock = make(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>);
export const IconBuilding = make(<><path d="M4 21V6l8-3v18M12 9h8v12M8 8h.01M8 12h.01M8 16h.01M16 13h.01M16 17h.01M2 21h20" /></>);
export const IconUser = make(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>);
export const IconUsers = make(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8" /></>);
export const IconBack = make(<path d="M15 5l-7 7 7 7" />);
export const IconX = make(<path d="M6 6l12 12M18 6 6 18" />);
export const IconKeyboard = make(<><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9" /></>);
export const IconSend = make(<path d="M5 12h13M13 6l6 6-6 6" />);
export const IconTag = make(<><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" /><circle cx="7.5" cy="7.5" r="1.3" /></>);
export const IconUserEdit = make(<><circle cx="10" cy="8" r="4" /><path d="M3 21a7 7 0 0 1 10-6.3M17.5 14.5l3 3L16 22h-3v-3z" /></>);
export const IconBriefcase = make(<><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18" /></>);
export const IconCalendar = make(<><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>);
export const IconNote = make(<><path d="M5 3h10l4 4v14H5z" /><path d="M14 3v5h5M8.5 13h7M8.5 17h5" /></>);
export const IconTask = make(<><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>);
export const IconChat = make(<path d="M4 5h16v11H9l-5 4z" />);
export const IconMail = make(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6.5 8.5 6.5 8.5-6.5" /></>);
export const IconReceipt = make(<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6M9 16h3" /></>);
export const IconBell = make(<><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>);
export const IconAlert = make(<><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></>);
export const IconPlus = make(<path d="M12 5v14M5 12h14" />);
export const IconTrash = make(<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />);
export const IconEdit = make(<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />);
export const IconLogout = make(<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11" />);
export const IconSearch = make(<><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>);
export const IconSparkle = make(<path d="M12 3c.8 4.6 2.4 6.2 7 7-4.6.8-6.2 2.4-7 7-.8-4.6-2.4-6.2-7-7 4.6-.8 6.2-2.4 7-7z" />);
export const IconCheck = make(<path d="m5 12.5 4.5 4.5L19 7.5" />);
