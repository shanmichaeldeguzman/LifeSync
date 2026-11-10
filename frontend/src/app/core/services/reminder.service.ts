import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { DataService } from '../data/data.service';
import { addDays, dateKey, parseDateKey } from '../utils/date';
import { isScheduled } from '../utils/habits';
import { expandEvent } from '../utils/recurrence';
import { UiService } from './ui.service';

interface PlannedReminder {
  key: string;
  at: Date;
  title: string;
  body: string;
  route: string;
}

const HORIZON_DAYS = 7;
const MAX_SCHEDULED = 60; // stay well under iOS (64) / Android alarm limits
const FIRED_KEY = 'lifesync-fired-reminders';

/** Stable 31-bit integer id from a string key (local notification ids must be ints). */
function hashId(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return Math.abs(h) % 2147483647;
}

/**
 * Plans reminders from local data and delivers them:
 *  - Android/iOS: scheduled OS local notifications, delivered even when the app is closed.
 *  - Web/PWA: browser notifications + in-app toasts while LifeSync is open. (Closed-app web push
 *    would need a push service; the server-side Notification Center still records every reminder.)
 */
@Injectable({ providedIn: 'root' })
export class ReminderService {
  private readonly data = inject(DataService);
  private readonly ui = inject(UiService);
  private readonly router = inject(Router);

  readonly permission = signal<'granted' | 'denied' | 'prompt' | 'unsupported'>('prompt');
  readonly native = Capacitor.isNativePlatform();
  private webTimer?: ReturnType<typeof setInterval>;
  private planned: PlannedReminder[] = [];
  private scheduleTimer?: ReturnType<typeof setTimeout>;
  private active = signal(false);

  constructor() {
    // Re-plan whenever relevant data or preferences change (debounced).
    effect(() => {
      if (!this.active()) return;
      this.data.list('tasks')();
      this.data.list('events')();
      this.data.list('habits')();
      this.data.list('habit_logs')();
      this.data.list('goals')();
      this.data.preferences();
      untracked(() => this.queueReschedule());
    });
    if (this.native) {
      LocalNotifications.addListener('localNotificationActionPerformed', (e) => {
        const route = (e.notification.extra as { route?: string } | undefined)?.route;
        if (route) void this.router.navigateByUrl(route);
      }).catch(() => undefined);
    }
  }

  async start() {
    this.active.set(true);
    await this.refreshPermission();
    if (!this.native) {
      clearInterval(this.webTimer);
      this.webTimer = setInterval(() => this.deliverDueWeb(), 30_000);
    }
  }

  async stop() {
    this.active.set(false);
    clearInterval(this.webTimer);
    clearTimeout(this.scheduleTimer);
    if (this.native) await this.cancelAllScheduled();
  }

  async refreshPermission() {
    if (this.native) {
      const p = await LocalNotifications.checkPermissions().catch(() => null);
      this.permission.set(p?.display === 'granted' ? 'granted' : p?.display === 'denied' ? 'denied' : 'prompt');
    } else if ('Notification' in window) {
      const p = Notification.permission;
      this.permission.set(p === 'default' ? 'prompt' : p);
    } else {
      this.permission.set('unsupported');
    }
  }

  async requestPermission(): Promise<boolean> {
    if (this.native) {
      const p = await LocalNotifications.requestPermissions();
      await this.refreshPermission();
      if (p.display === 'granted') this.queueReschedule();
      return p.display === 'granted';
    }
    if ('Notification' in window) {
      const p = await Notification.requestPermission();
      await this.refreshPermission();
      return p === 'granted';
    }
    return false;
  }

  /** Sends a test notification so users can verify delivery on their device. */
  async sendTest() {
    if (this.native) {
      await LocalNotifications.schedule({
        notifications: [{ id: 1, title: 'LifeSync', body: 'Notifications are working.', schedule: { at: new Date(Date.now() + 1500) } }],
      });
    } else if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('LifeSync', { body: 'Notifications are working.', icon: 'assets/icon/icon-192.png' });
    } else {
      await this.ui.toast('Notifications are working (in-app).', 'info');
    }
  }

  private queueReschedule() {
    clearTimeout(this.scheduleTimer);
    this.scheduleTimer = setTimeout(() => void this.reschedule(), 1500);
  }

  /** Builds the list of reminders due within the planning horizon. */
  plan(now = new Date()): PlannedReminder[] {
    const prefs = this.data.preferences();
    if (prefs && !prefs.push_enabled) return [];
    const horizon = addDays(now, HORIZON_DAYS);
    const out: PlannedReminder[] = [];
    const inWindow = (d: Date) => d.getTime() > now.getTime() - 60_000 && d <= horizon;

    if (!prefs || prefs.notify_tasks) {
      for (const t of this.data.list('tasks')()) {
        if (t.status === 'completed' || !t.reminder_at) continue;
        const at = new Date(t.reminder_at);
        if (inWindow(at)) out.push({ key: `task:${t.id}:${t.reminder_at}`, at, title: 'Task reminder', body: t.title, route: '/tasks' });
      }
    }
    if (!prefs || prefs.notify_events) {
      for (const e of this.data.list('events')()) {
        if (e.reminder_minutes === null) continue;
        for (const occ of expandEvent(e, now, addDays(horizon, 1))) {
          const at = new Date(occ.start.getTime() - e.reminder_minutes * 60_000);
          if (!inWindow(at)) continue;
          const when = e.reminder_minutes === 0 ? 'Starting now' : `Starts in ${e.reminder_minutes} min`;
          out.push({ key: `event:${e.id}:${occ.start.getTime()}`, at, title: e.title, body: when, route: `/calendar?date=${dateKey(occ.start)}` });
        }
      }
    }
    if (!prefs || prefs.notify_habits) {
      const done = new Set(this.data.list('habit_logs')().map((l) => `${l.habit_id}:${l.log_date}`));
      for (const h of this.data.list('habits')()) {
        if (h.is_archived || !h.reminder_time) continue;
        const [hh, mm] = h.reminder_time.split(':').map(Number);
        for (let i = 0; i <= HORIZON_DAYS; i++) {
          const day = addDays(parseDateKey(dateKey(now)), i);
          const key = dateKey(day);
          if (!isScheduled(h, key) || done.has(`${h.id}:${key}`)) continue;
          const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm);
          if (inWindow(at)) out.push({ key: `habit:${h.id}:${key}`, at, title: `Time for: ${h.name}`, body: 'A small step today keeps the momentum going.', route: '/habits' });
        }
      }
    }
    if (!prefs || prefs.notify_goals) {
      for (const g of this.data.list('goals')()) {
        if (g.status !== 'active' || !g.reminder_at) continue;
        const at = new Date(g.reminder_at);
        if (inWindow(at)) out.push({ key: `goal:${g.id}:${g.reminder_at}`, at, title: 'Goal check-in', body: g.title, route: `/goals/${g.id}` });
      }
    }
    return out.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, MAX_SCHEDULED);
  }

  private async reschedule() {
    this.planned = this.plan();
    if (!this.native || this.permission() !== 'granted') return;
    await this.cancelAllScheduled();
    const future = this.planned.filter((p) => p.at.getTime() > Date.now() + 5000);
    if (!future.length) return;
    await LocalNotifications.schedule({
      notifications: future.map((p) => ({
        id: hashId(p.key),
        title: p.title,
        body: p.body,
        schedule: { at: p.at, allowWhileIdle: true },
        extra: { route: p.route },
      })),
    }).catch(() => undefined);
  }

  private async cancelAllScheduled() {
    const pending = await LocalNotifications.getPending().catch(() => null);
    if (pending?.notifications.length) {
      await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) }).catch(() => undefined);
    }
  }

  /** Web: deliver reminders that became due while the app is open (each only once). */
  private deliverDueWeb() {
    const now = Date.now();
    let fired: string[] = [];
    try {
      fired = JSON.parse(localStorage.getItem(FIRED_KEY) ?? '[]') as string[];
    } catch {
      fired = [];
    }
    const firedSet = new Set(fired);
    const due = this.plan(new Date(now - 5 * 60_000)).filter((p) => p.at.getTime() <= now && !firedSet.has(p.key));
    for (const p of due) {
      firedSet.add(p.key);
      if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        const n = new Notification(p.title, { body: p.body, icon: 'assets/icon/icon-192.png', tag: p.key });
        n.onclick = () => {
          window.focus();
          void this.router.navigateByUrl(p.route);
        };
      } else {
        void this.ui.toast(`${p.title}: ${p.body}`, 'info', 6000);
      }
    }
    try {
      localStorage.setItem(FIRED_KEY, JSON.stringify([...firedSet].slice(-300)));
    } catch {
      /* ignore */
    }
  }
}
