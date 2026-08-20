import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import Toast from 'react-native-toast-message';
import { Provider } from '@/components/Provider';
import { FontProvider } from '@/contexts/FontContext';

import '../global.css';

export default function RootLayout() {
  return (
    <FontProvider>
      <Provider>
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
        <Stack.Screen name="index" options={{ title: "" }} />
        <Stack.Screen name="compose" options={{ title: "", animation: 'slide_from_bottom' }} />
        <Stack.Screen name="profile" options={{ title: "" }} />
      </Stack>
      <Toast />
      </Provider>
    </FontProvider>
  );
}
