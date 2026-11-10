import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { inject, isDevMode, provideAppInitializer } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { PreloadAllModules, RouteReuseStrategy, provideRouter, withComponentInputBinding, withPreloading } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { Capacitor } from '@capacitor/core';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular';

import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { authInterceptor } from './app/core/interceptors/auth.interceptor';
import { AuthService } from './app/core/services/auth.service';
import { SessionService } from './app/core/services/session.service';
import { registerIcons } from './app/icons';

registerIcons();

bootstrapApplication(AppComponent, {
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideIonicAngular({ mode: 'md', innerHTMLTemplatesEnabled: false }),
    provideRouter(routes, withPreloading(PreloadAllModules), withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    provideAppInitializer(async () => {
      inject(SessionService); // wires the sign-in / sign-out lifecycle
      await inject(AuthService).init();
    }),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode() && !Capacitor.isNativePlatform(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
}).catch((err) => console.error(err));
