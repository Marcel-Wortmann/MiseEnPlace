import { Component, inject } from '@angular/core';
import { NotificationStore } from '../store/Notification/Notification.store';

@Component({
  selector: 'app-notification',
  imports: [],
  templateUrl: './notification.html',
  styleUrl: './notification.css',
})
export class NotificationComponent {
  readonly store = inject(NotificationStore);
}
