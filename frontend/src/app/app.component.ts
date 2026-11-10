import { Component, inject } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { ThemeService } from './core/services/theme.service';

@Component({
  selector: 'app-root',
  imports: [IonApp, IonRouterOutlet],
  template: `<ion-app><ion-router-outlet></ion-router-outlet></ion-app>`,
})
export class AppComponent {
  // Instantiated at startup so the saved theme applies before first paint.
  private readonly theme = inject(ThemeService);
}
