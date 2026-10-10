// Current UTC offset (hours) and short label for an IANA timezone, e.g. Asia/Karachi -> { 5, "GMT+5" }.
// Computed per call on the server, so daylight saving is always right.
export function tzInfo(timeZone: string, at = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(at);
    const off = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT';
    const m = off.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    const hours = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) + Number(m[3] || 0) / 60) : 0;
    const short = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(at).find((p) => p.type === 'timeZoneName')?.value || off;
    return { offsetHours: hours, label: short };
  } catch {
    return { offsetHours: 0, label: 'UTC' };
  }
}

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
