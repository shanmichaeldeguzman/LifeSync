import { Component, input, output } from '@angular/core';
import { IonButton, IonIcon } from '@ionic/angular';

/** Friendly empty state with an illustration-style icon and optional call to action. */
@Component({
  selector: 'app-empty-state',
  imports: [IonIcon, IonButton],
  template: `
    <div class="empty ls-fade-in" [class.compact]="compact()">
      <div class="art" aria-hidden="true">
        <div class="ring"></div>
        <ion-icon [name]="icon()"></ion-icon>
      </div>
      <h3>{{ title() }}</h3>
      @if (message()) {
        <p>{{ message() }}</p>
      }
      @if (actionText()) {
        <ion-button size="small" (click)="action.emit()">
          <ion-icon slot="start" name="add"></ion-icon>
          {{ actionText() }}
        </ion-button>
      }
    </div>
  `,
  styles: `
    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 40px 20px;
    }
    .empty.compact { padding: 20px 12px; }
    .art {
      position: relative;
      width: 88px;
      height: 88px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
    }
    .compact .art { width: 60px; height: 60px; margin-bottom: 10px; }
    .ring {
      position: absolute;
      inset: 0;
      border-radius: 28px;
      background: var(--ls-primary-soft);
      transform: rotate(8deg);
    }
    ion-icon {
      position: relative;
      font-size: 38px;
      color: var(--ion-color-primary);
    }
    .compact ion-icon { font-size: 26px; }
    h3 { font-size: 1.05rem; font-weight: 700; margin-bottom: 6px; }
    .compact h3 { font-size: 0.92rem; }
    p { color: var(--ls-text-2); font-size: 0.88rem; max-width: 340px; margin: 0 0 16px; line-height: 1.5; }
    .compact p { font-size: 0.8rem; margin-bottom: 10px; }
  `,
})
export class EmptyStateComponent {
  readonly icon = input('sparkles-outline');
  readonly title = input.required<string>();
  readonly message = input<string>('');
  readonly actionText = input<string>('');
  readonly compact = input(false);
  readonly action = output<void>();
}
