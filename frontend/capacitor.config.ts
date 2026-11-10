import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lifesync.mobile',
  appName: 'LifeSync',
  webDir: 'www',
  server: {
    // Serve the app from https://localhost inside the WebView (secure context:
    // required for crypto.randomUUID, IndexedDB persistence and Supabase auth).
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#F7F8FC',
  },
  plugins: {
    LocalNotifications: {
      iconColor: '#635BFF',
    },
    Keyboard: {
      resizeOnFullScreen: true,
    },
  },
};

export default config;
