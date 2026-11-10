import { Component, input } from '@angular/core';
import { IonIcon } from '@ionic/angular';
import type { SyncStatus } from '../../core/models';

/**
 * Marks records saved only on this device (not yet in the cloud) or needing review,
 * so locally-saved data is always distinguishable from synchronised data.
 */
@Component({
  selector: 'app-sync-badge',
  imports: [IonIcon],
  template: `
    @if (status() === 'pending') {
      <span class="ls-chip info" title="Saved on this device, will sync when online"><ion-icon name="cloud-upload-outline"></ion-icon>Local</span>
    } @else if (status() === 'conflict') {
      <span class="ls-chip warning" title="Needs review: open Settings, then Sync"><ion-icon name="alert-circle-outline"></ion-icon>Review</span>
    }
  `,
})
export class SyncBadgeComponent {
  readonly status = input<SyncStatus | undefined>(undefined);
}
