import { Component, computed, input } from '@angular/core';

/** Loading placeholders shaped like list rows or cards. */
@Component({
  selector: 'app-skeleton',
  template: `
    @if (variant() === 'cards') {
      <div class="ls-grid cols-3">
        @for (i of items(); track i) {
          <div class="ls-card"><div class="ls-skeleton" style="height:18px;width:50%"></div><div class="ls-skeleton" style="height:12px;width:80%;margin-top:14px"></div><div class="ls-skeleton" style="height:12px;width:65%;margin-top:8px"></div></div>
        }
      </div>
    } @else {
      <div class="ls-card flush" aria-busy="true" aria-label="Loading">
        @for (i of items(); track i) {
          <div class="ls-row">
            <div class="ls-skeleton" style="width:36px;height:36px;border-radius:11px"></div>
            <div class="grow">
              <div class="ls-skeleton" style="height:13px" [style.width.%]="55 + (i % 3) * 12"></div>
              <div class="ls-skeleton" style="height:10px;margin-top:8px" [style.width.%]="30 + (i % 2) * 15"></div>
            </div>
          </div>
        }
      </div>
    }
  `,
})
export class SkeletonComponent {
  readonly rows = input(5);
  readonly variant = input<'rows' | 'cards'>('rows');
  readonly items = computed(() => Array.from({ length: this.rows() }, (_, i) => i));
}
