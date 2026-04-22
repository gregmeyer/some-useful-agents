/**
 * Convert a 5-field cron expression to a human-readable description.
 * Handles common patterns: daily, weekly, monthly, step intervals, weekday ranges.
 */
export function cronToHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return cron;

  const [min, hour, dom, mon, dow] = parts;
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  function fmtTime(h: string, m: string): string {
    if (h === '*' && m === '*') return '';
    if (h === '*') return `at minute ${m}`;
    const hour24 = parseInt(h, 10);
    const minute = m === '*' ? 0 : parseInt(m, 10);
    if (isNaN(hour24)) return `at ${h}:${m.padStart(2, '0')}`;
    const ampm = hour24 >= 12 ? 'PM' : 'AM';
    const hour12 = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24;
    return `at ${String(hour12)}:${String(minute).padStart(2, '0')} ${ampm}`;
  }

  function stepDesc(field: string, unit: string): string | null {
    const stepMatch = field.match(/^\*\/(\d+)$/);
    if (stepMatch) return `every ${stepMatch[1]} ${unit}${parseInt(stepMatch[1], 10) !== 1 ? 's' : ''}`;
    return null;
  }

  const time = fmtTime(hour, min);

  // Every minute: * * * * *
  if (min === '*' && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return 'Every minute';
  }

  // Every N minutes: */N * * * *
  const minStep = stepDesc(min, 'minute');
  if (minStep && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return minStep.charAt(0).toUpperCase() + minStep.slice(1);
  }

  // Every hour at minute M: M * * * *
  if (min !== '*' && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return `Every hour at minute ${min}`;
  }

  // Every N hours: 0 */N * * *
  const hourStep = stepDesc(hour, 'hour');
  if (hourStep && dom === '*' && mon === '*' && dow === '*') {
    return hourStep.charAt(0).toUpperCase() + hourStep.slice(1);
  }

  // Daily: M H * * *
  if (min !== '*' && hour !== '*' && dom === '*' && mon === '*' && dow === '*') {
    return `Every day ${time}`;
  }

  // Specific days of week: M H * * D
  if (dom === '*' && mon === '*' && dow !== '*') {
    const dayNames = dow.split(',').map((d) => {
      const n = parseInt(d, 10);
      return isNaN(n) ? d : (DAYS[n] ?? d);
    });
    if (dow === '1-5') return `Weekdays ${time}`;
    if (dow === '0,6') return `Weekends ${time}`;
    return `${dayNames.join(', ')} ${time}`;
  }

  // Specific day of month: M H D * *
  if (dom !== '*' && mon === '*' && dow === '*') {
    const suffix = dom === '1' ? 'st' : dom === '2' ? 'nd' : dom === '3' ? 'rd' : 'th';
    return `${dom}${suffix} of every month ${time}`;
  }

  // Specific month + day: M H D Mo *
  if (dom !== '*' && mon !== '*' && dow === '*') {
    const monthNum = parseInt(mon, 10);
    const monthName = isNaN(monthNum) ? mon : (MONTHS[monthNum] ?? mon);
    return `${monthName} ${dom} ${time}`;
  }

  return cron;
}
