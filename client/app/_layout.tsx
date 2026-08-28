import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import Toast from 'react-native-toast-message';
import { Provider } from '@/components/Provider';
import { FontProvider } from '@/contexts/FontContext';
import { OtaUpdateProvider } from '@/contexts/OtaUpdateContext';
import { NotificationBridge } from '@/services/NotificationBridge';

import '../global.css';

export default function RootLayout() {
  return (
    <FontProvider>
      <Provider>
        <OtaUpdateProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              animation: 'slide_from_right',
              gestureEnabled: true,
              gestureDirection: 'horizontal',
              headerShown: false,
              contentStyle: { backgroundColor: '#0B0E23' },
            }}
          >
            <Stack.Screen name="index" options={{ title: '' }} />
            <Stack.Screen name="onboarding" options={{ title: '', animation: 'fade', gestureEnabled: false }} />
            <Stack.Screen name="compose" options={{ title: '', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="profile" options={{ title: '' }} />
          </Stack>
          <Toast />
          <NotificationBridge />
        </OtaUpdateProvider>
      </Provider>
    </FontProvider>
  );
}
