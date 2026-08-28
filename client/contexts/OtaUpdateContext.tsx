import { FontAwesome6 } from '@expo/vector-icons';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ActivityIndicator, AppState, Modal, Text, TouchableOpacity, View } from 'react-native';
import { useApp } from '@/contexts/AppContext';
import { useHandwritingFont } from '@/contexts/FontContext';
import { type OtaStatus, useOtaUpdate } from '@/hooks/useOtaUpdate';

type OtaUpdateContextValue = {
  status: OtaStatus;
  isPromptVisible: boolean;
  openPrompt: () => void;
};

const OtaUpdateContext = createContext<OtaUpdateContextValue | null>(null);

function ArrivalStar() {
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ width: 76, height: 76, alignItems: 'center', justifyContent: 'center' }}
    >
      <View
        style={{
          position: 'absolute',
          width: 72,
          height: 72,
          borderRadius: 36,
          borderWidth: 1,
          borderColor: 'rgba(245,194,107,0.13)',
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: 48,
          height: 48,
          borderRadius: 24,
          borderWidth: 1,
          borderColor: 'rgba(245,194,107,0.28)',
          transform: [{ rotate: '-18deg' }],
        }}
      />
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#F5C26B',
          shadowColor: '#F5C26B',
          shadowOpacity: 0.65,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 0 },
          elevation: 8,
        }}
      >
        <FontAwesome6 name="star" size={11} color="#0B0E23" />
      </View>
      <View
        style={{
          position: 'absolute',
          top: 10,
          right: 12,
          width: 5,
          height: 5,
          borderRadius: 3,
          backgroundColor: '#FFE3A3',
        }}
      />
    </View>
  );
}

function UpdatePrompt({
  visible,
  applying,
  error,
  onApply,
  onDismiss,
}: {
  visible: boolean;
  applying: boolean;
  error: string | null;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const handwriting = useHandwritingFont();

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 24,
          paddingVertical: 36,
          backgroundColor: 'rgba(6,8,25,0.90)',
        }}
      >
        <View
          accessibilityViewIsModal
          style={{
            width: '100%',
            maxWidth: 380,
            overflow: 'hidden',
            borderRadius: 26,
            borderWidth: 1,
            borderColor: 'rgba(245,194,107,0.30)',
            backgroundColor: '#171A3A',
            paddingHorizontal: 24,
            paddingTop: 22,
            paddingBottom: 20,
            shadowColor: '#000000',
            shadowOpacity: 0.42,
            shadowRadius: 30,
            shadowOffset: { width: 0, height: 18 },
            elevation: 18,
          }}
        >
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: -72,
              right: -58,
              width: 180,
              height: 180,
              borderRadius: 90,
              backgroundColor: 'rgba(245,194,107,0.055)',
            }}
          />

          <View style={{ alignItems: 'center' }}>
            <ArrivalStar />
            <Text
              style={{
                marginTop: 10,
                fontSize: 10,
                color: 'rgba(245,194,107,0.72)',
                letterSpacing: 3,
              }}
            >
              版本更新
            </Text>
            <Text
              accessibilityRole="header"
              style={{
                marginTop: 9,
                fontFamily: handwriting,
                fontSize: 24,
                lineHeight: 34,
                color: '#FFE3A3',
                letterSpacing: 1.5,
                textAlign: 'center',
              }}
            >
              新版本已经抵达
            </Text>
            <Text
              style={{
                marginTop: 10,
                fontSize: 14,
                lineHeight: 22,
                color: 'rgba(237,231,246,0.86)',
                textAlign: 'center',
              }}
            >
              更新内容已经下载好，重启应用即可生效。
            </Text>
            <Text
              style={{
                marginTop: 7,
                fontSize: 11.5,
                lineHeight: 18,
                color: 'rgba(142,139,163,0.86)',
                textAlign: 'center',
              }}
            >
              应用会短暂重启；如果正在写留言，可以先暂时忽略。
            </Text>
          </View>

          {error && (
            <Text
              accessibilityRole="alert"
              style={{
                marginTop: 14,
                fontSize: 12,
                lineHeight: 18,
                color: '#F2A7C8',
                textAlign: 'center',
              }}
            >
              {error}
            </Text>
          )}

          <View style={{ flexDirection: 'row', gap: 12, marginTop: error ? 14 : 22 }}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="暂时忽略这次更新提示"
              activeOpacity={0.72}
              disabled={applying}
              onPress={onDismiss}
              style={{
                flex: 1,
                minHeight: 48,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 999,
                borderWidth: 1,
                borderColor: 'rgba(237,231,246,0.16)',
                backgroundColor: 'rgba(255,255,255,0.035)',
                opacity: applying ? 0.48 : 1,
              }}
            >
              <Text style={{ fontSize: 14, color: '#A7A3B8', letterSpacing: 0.5 }}>暂时忽略</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={applying ? '正在更新' : '立即更新'}
              activeOpacity={0.82}
              disabled={applying}
              onPress={onApply}
              style={{
                flex: 1,
                minHeight: 48,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                borderRadius: 999,
                backgroundColor: '#F5C26B',
                opacity: applying ? 0.72 : 1,
              }}
            >
              {applying && <ActivityIndicator size="small" color="#0B0E23" />}
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#0B0E23', letterSpacing: 0.5 }}>
                {applying ? '正在更新…' : '立即更新'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function OtaUpdateProvider({ children }: { children: ReactNode }) {
  const { onboarded } = useApp();
  const { status, updateId, reload } = useOtaUpdate();
  const [appState, setAppState] = useState(AppState.currentState);
  const [promptManuallyOpened, setPromptManuallyOpened] = useState(false);
  const [dismissedUpdateId, setDismissedUpdateId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  const dismissPrompt = useCallback(() => {
    if (applying) return;
    setError(null);
    setPromptManuallyOpened(false);
    setDismissedUpdateId(updateId);
  }, [applying, updateId]);

  const openPrompt = useCallback(() => {
    if (status !== 'ready' || applying) return;
    setError(null);
    setPromptManuallyOpened(true);
  }, [applying, status]);

  const applyUpdate = useCallback(async () => {
    if (applying) return;
    setApplying(true);
    setError(null);
    try {
      await reload();
    } catch {
      setApplying(false);
      setError('更新暂时无法启动，请稍后再试。');
    }
  }, [applying, reload]);

  const isPromptVisible =
    status === 'ready' &&
    updateId !== null &&
    onboarded === true &&
    appState === 'active' &&
    (promptManuallyOpened || dismissedUpdateId !== updateId);
  const value = useMemo(
    () => ({ status, isPromptVisible, openPrompt }),
    [isPromptVisible, openPrompt, status]
  );

  return (
    <OtaUpdateContext.Provider value={value}>
      {children}
      <UpdatePrompt
        visible={isPromptVisible}
        applying={applying}
        error={error}
        onApply={() => void applyUpdate()}
        onDismiss={dismissPrompt}
      />
    </OtaUpdateContext.Provider>
  );
}

export function useOtaUpdatePrompt(): OtaUpdateContextValue {
  const context = useContext(OtaUpdateContext);
  if (!context) {
    throw new Error('useOtaUpdatePrompt must be used within OtaUpdateProvider.');
  }
  return context;
}
