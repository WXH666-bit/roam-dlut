import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LogBox, View, ActivityIndicator } from 'react-native';
import Toast from 'react-native-toast-message';
import { useFonts } from 'expo-font';
import { MaShanZheng_400Regular } from '@expo-google-fonts/ma-shan-zheng';
import { NotoSerifSC_300Light, NotoSerifSC_600SemiBold } from '@expo-google-fonts/noto-serif-sc';
import { Provider } from '@/components/Provider';

import '../global.css';

LogBox.ignoreLogs([
  "TurboModuleRegistry.getEnforcing(...): 'RNMapsAirModule' could not be found",
  // 添加其它想暂时忽略的错误或警告信息
]);

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    MaShanZheng_400Regular,
    NotoSerifSC_300Light,
    NotoSerifSC_600SemiBold,
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0B0E23', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#F5C26B" />
      </View>
    );
  }

  return (
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
  );
}
