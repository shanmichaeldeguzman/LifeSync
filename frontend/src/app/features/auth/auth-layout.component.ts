import { Component, input } from '@angular/core';
import { IonIcon } from '@ionic/angular';

/** Split-screen auth layout: brand panel on large screens, focused form card on phones. */
@Component({
  selector: 'app-auth-layout',
  imports: [IonIcon],
  template: `
    <div class="auth">
      <aside class="brand-panel" aria-hidden="true">
        <div class="brand"><span class="logo"><ion-icon name="sync"></ion-icon></span> LifeSync</div>
        <div class="pitch">
          <h2>Your whole life,<br />beautifully in sync.</h2>
          <p>Tasks, calendar, habits, notes, money, documents and goals in one calm, private place.</p>
          <ul>
            <li><ion-icon name="checkmark-circle"></ion-icon> Works offline, syncs when you're back</li>
            <li><ion-icon name="checkmark-circle"></ion-icon> Private by design: your data is yours</li>
            <li><ion-icon name="checkmark-circle"></ion-icon> On your phone, tablet and desktop</li>
          </ul>
        </div>
        <div class="floating">
          <div class="mini-card"><ion-icon name="checkbox-outline"></ion-icon><span>3 tasks done today</span></div>
          <div class="mini-card two"><ion-icon name="flame-outline"></ion-icon><span>12-day reading streak</span></div>
        </div>
      </aside>
      <main class="form-panel">
        <div class="form-card ls-fade-in">
          <div class="mobile-brand"><span class="logo"><ion-icon name="sync"></ion-icon></span> LifeSync</div>
          <h1>{{ heading() }}</h1>
          @if (subheading()) { <p class="sub">{{ subheading() }}</p> }
          <ng-content></ng-content>
        </div>
      </main>
    </div>
  `,
  styles: `
    .auth { min-height: 100%; display: flex; background: var(--ion-background-color); }
    .brand-panel {
      display: none; position: relative; overflow: hidden; flex: 0 0 46%;
      background: radial-gradient(circle at 20% 20%, #8b85ff 0%, transparent 45%), linear-gradient(150deg, #4f46e5 0%, #635bff 45%, #8b85ff 100%);
      color: #fff; padding: 48px; flex-direction: column; justify-content: space-between;
    }
    @media (min-width: 992px) { .brand-panel { display: flex; } .mobile-brand { display: none !important; } }
    .brand, .mobile-brand { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 1.25rem; letter-spacing: -0.03em; }
    .logo { width: 38px; height: 38px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.18); font-size: 20px; }
    .mobile-brand { margin-bottom: 28px; }
    .mobile-brand .logo { background: var(--ls-gradient); color: #fff; }
    .pitch h2 { color: #fff; font-size: 2.5rem; font-weight: 800; line-height: 1.1; letter-spacing: -0.035em; }
    .pitch p { font-size: 1.05rem; opacity: 0.88; max-width: 420px; line-height: 1.55; margin: 18px 0 24px; }
    .pitch ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }
    .pitch li { display: flex; align-items: center; gap: 10px; font-weight: 500; }
    .floating { position: relative; height: 110px; }
    .mini-card { position: absolute; left: 0; bottom: 40px; display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.14); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.25); padding: 12px 16px; border-radius: 14px; font-weight: 600; font-size: 0.9rem; }
    .mini-card.two { left: 160px; bottom: 0; }
    .form-panel { flex: 1; display: flex; align-items: center; justify-content: center; padding: 32px 20px calc(32px + env(safe-area-inset-bottom)); }
    .form-card { width: 100%; max-width: 420px; }
    h1 { font-size: 1.75rem; font-weight: 800; letter-spacing: -0.03em; }
    .sub { color: var(--ls-text-2); margin: 8px 0 26px; line-height: 1.5; }
  `,
})
export class AuthLayoutComponent {
  readonly heading = input.required<string>();
  readonly subheading = input('');
}
