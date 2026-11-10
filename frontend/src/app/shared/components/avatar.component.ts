import { Component, effect, inject, input, signal } from '@angular/core';
import { StorageService } from '../../core/services/storage.service';

/** Circular avatar loaded from the private avatars bucket, with an initials fallback. */
@Component({
  selector: 'app-avatar',
  template: `
    <span class="avatar" [style.width.px]="size()" [style.height.px]="size()" [style.font-size.px]="size() * 0.38">
      @if (src()) {
        <img [src]="src()" alt="" (error)="src.set(null)" />
      } @else {
        {{ initials() }}
      }
    </span>
  `,
  styles: `
    .avatar {
      border-radius: 50%;
      background: var(--ls-gradient);
      color: #fff;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      overflow: hidden;
      flex-shrink: 0;
      letter-spacing: 0;
    }
    img { width: 100%; height: 100%; object-fit: cover; }
  `,
})
export class AvatarComponent {
  private readonly storage = inject(StorageService);
  readonly path = input<string | null>(null);
  readonly initials = input('?');
  readonly size = input(40);
  readonly src = signal<string | null>(null);

  constructor() {
    effect(() => {
      const p = this.path();
      this.src.set(null);
      if (p && navigator.onLine) {
        this.storage.objectUrl('avatars', p).then((u) => this.src.set(u)).catch(() => this.src.set(null));
      }
    });
  }
}
