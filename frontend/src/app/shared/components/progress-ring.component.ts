import { Component, computed, input } from '@angular/core';

/** SVG progress ring with a centered label. */
@Component({
  selector: 'app-progress-ring',
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" [attr.viewBox]="'0 0 ' + size() + ' ' + size()" role="img" [attr.aria-label]="value() + '% complete'">
      <circle [attr.cx]="c()" [attr.cy]="c()" [attr.r]="r()" fill="none" stroke="var(--ls-surface-2)" [attr.stroke-width]="stroke()" />
      <circle
        [attr.cx]="c()" [attr.cy]="c()" [attr.r]="r()" fill="none"
        [attr.stroke]="color()" [attr.stroke-width]="stroke()" stroke-linecap="round"
        [attr.stroke-dasharray]="circ()" [attr.stroke-dashoffset]="offset()"
        [attr.transform]="'rotate(-90 ' + c() + ' ' + c() + ')'"
        style="transition: stroke-dashoffset 0.6s ease"
      />
      <text [attr.x]="c()" [attr.y]="c()" text-anchor="middle" dominant-baseline="central" [attr.font-size]="size() * 0.24" font-weight="750" fill="var(--ls-text)">
        {{ label() ?? value() + '%' }}
      </text>
    </svg>
  `,
  styles: `:host { display: inline-flex; flex-shrink: 0; }`,
})
export class ProgressRingComponent {
  readonly value = input(0);
  readonly size = input(64);
  readonly stroke = input(7);
  readonly color = input('var(--ion-color-primary)');
  readonly label = input<string | null>(null);
  readonly c = computed(() => this.size() / 2);
  readonly r = computed(() => (this.size() - this.stroke()) / 2);
  readonly circ = computed(() => 2 * Math.PI * this.r());
  readonly offset = computed(() => this.circ() * (1 - Math.min(100, Math.max(0, this.value())) / 100));
}
