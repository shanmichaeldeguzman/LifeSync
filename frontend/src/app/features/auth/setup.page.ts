import { Component } from '@angular/core';
import { IonContent, IonIcon } from '@ionic/angular';
import { AuthLayoutComponent } from './auth-layout.component';

/** Shown when the build is missing its Supabase/API configuration. */
@Component({
  selector: 'app-setup',
  imports: [IonContent, IonIcon, AuthLayoutComponent],
  template: `
    <ion-content>
      <app-auth-layout heading="Almost there" subheading="This LifeSync build has not been configured yet.">
        <div class="ls-banner warning"><ion-icon name="construct-outline"></ion-icon>
          <span>Set <code>LIFESYNC_SUPABASE_URL</code>, <code>LIFESYNC_SUPABASE_ANON_KEY</code> and <code>LIFESYNC_API_URL</code>, then rebuild. See the README for details.</span>
        </div>
      </app-auth-layout>
    </ion-content>
  `,
})
export class SetupPage {}
