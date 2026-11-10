import { Component, input, model } from '@angular/core';
import { IonIcon } from '@ionic/angular';
import { COLOR_CHOICES, ICON_CHOICES } from '../../core/utils/format';

/** Swatch color picker (two-way bound with [(value)]). */
@Component({
  selector: 'app-color-picker',
  template: `
    <div class="swatches" role="radiogroup" aria-label="Color">
      @for (c of colors; track c) {
        <button type="button" class="swatch" role="radio" [attr.aria-checked]="value() === c" [attr.aria-label]="c" [style.background]="c" [class.active]="value().toLowerCase() === c.toLowerCase()" (click)="value.set(c)"></button>
      }
    </div>
  `,
  styles: `
    .swatches { display: flex; flex-wrap: wrap; gap: 10px; }
    .swatch { width: 30px; height: 30px; border-radius: 50%; border: 0; cursor: pointer; padding: 0; transition: transform 0.15s ease; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.08); }
    .swatch:hover { transform: scale(1.1); }
    .swatch.active { box-shadow: 0 0 0 3px var(--ls-surface), 0 0 0 5px currentColor; outline: 2px solid var(--ls-text); outline-offset: 2px; }
  `,
})
export class ColorPickerComponent {
  readonly value = model('#635BFF');
  readonly colors = COLOR_CHOICES;
}

/** Icon grid picker (two-way bound with [(value)]). */
@Component({
  selector: 'app-icon-picker',
  imports: [IonIcon],
  template: `
    <div class="icons" role="radiogroup" aria-label="Icon">
      @for (i of icons; track i) {
        <button type="button" role="radio" [attr.aria-checked]="value() === i" [attr.aria-label]="i" [class.active]="value() === i" [style.--accent]="color()" (click)="value.set(i)">
          <ion-icon [name]="i"></ion-icon>
        </button>
      }
    </div>
  `,
  styles: `
    .icons { display: grid; grid-template-columns: repeat(auto-fill, minmax(42px, 1fr)); gap: 8px; }
    button { height: 42px; border-radius: 12px; border: 1px solid var(--ls-border); background: var(--ls-surface); color: var(--ls-text-2); font-size: 20px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
    button.active { border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
  `,
})
export class IconPickerComponent {
  readonly value = model('leaf-outline');
  readonly color = input('#635BFF');
  readonly icons = ICON_CHOICES;
}
