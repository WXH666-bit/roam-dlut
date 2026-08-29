import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import { FontAwesome6 } from '@expo/vector-icons';
import { formatMediaDuration } from '@/utils/media';

interface AudioAttachmentPlayerProps {
  uri: string;
  label?: string;
  paper?: boolean;
}

export function AudioAttachmentPlayer({
  uri,
  label = '一段声音',
  paper = false,
}: AudioAttachmentPlayerProps) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const generationRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [failed, setFailed] = useState(false);

  const onStatus = useCallback((status: AVPlaybackStatus, generation: number) => {
    if (!mountedRef.current || generationRef.current !== generation) return;
    if (!status.isLoaded) {
      if (status.error) {
        const failedSound = soundRef.current;
        soundRef.current = null;
        failedSound?.setOnPlaybackStatusUpdate(null);
        if (failedSound) void failedSound.unloadAsync().catch(() => undefined);
        busyRef.current = false;
        setFailed(true);
        setBusy(false);
        setPlaying(false);
      }
      return;
    }
    setPlaying(status.isPlaying);
    setPositionMs(status.positionMillis);
    setDurationMs(status.durationMillis ?? 0);
    setBusy(false);
  }, []);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    mountedRef.current = true;
    busyRef.current = false;
    setBusy(false);
    setPlaying(false);
    setPositionMs(0);
    setDurationMs(0);
    setFailed(false);
    return () => {
      mountedRef.current = false;
      if (generationRef.current === generation) generationRef.current += 1;
      busyRef.current = false;
      const sound = soundRef.current;
      soundRef.current = null;
      sound?.setOnPlaybackStatusUpdate(null);
      if (sound) void sound.unloadAsync().catch(() => undefined);
    };
  }, [uri]);

  const togglePlayback = async () => {
    if (busyRef.current) return;
    const generation = generationRef.current;
    busyRef.current = true;
    setBusy(true);
    setFailed(false);
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
      let sound = soundRef.current;
      if (!sound) {
        const statusHandler = (status: AVPlaybackStatus) => onStatus(status, generation);
        const created = await Audio.Sound.createAsync(
          { uri },
          { shouldPlay: true, progressUpdateIntervalMillis: 250 },
          statusHandler
        );
        if (!mountedRef.current || generationRef.current !== generation) {
          created.sound.setOnPlaybackStatusUpdate(null);
          await created.sound.unloadAsync().catch(() => undefined);
          return;
        }
        sound = created.sound;
        soundRef.current = sound;
        onStatus(created.status, generation);
        return;
      }
      const status = await sound.getStatusAsync();
      if (!status.isLoaded) throw new Error('audio_not_loaded');
      if (status.isPlaying) {
        await sound.pauseAsync();
      } else if (
        status.durationMillis != null
        && status.positionMillis >= Math.max(0, status.durationMillis - 250)
      ) {
        await sound.replayAsync({ shouldPlay: true });
      } else {
        await sound.playAsync();
      }
    } catch {
      if (mountedRef.current && generationRef.current === generation) {
        const failedSound = soundRef.current;
        soundRef.current = null;
        failedSound?.setOnPlaybackStatusUpdate(null);
        if (failedSound) await failedSound.unloadAsync().catch(() => undefined);
        setPlaying(false);
        setFailed(true);
      }
    } finally {
      if (mountedRef.current && generationRef.current === generation) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };

  const ink = paper ? '#3E3626' : '#EDE7F6';
  const softInk = paper ? 'rgba(62,54,38,0.58)' : '#8E8BA3';
  const background = paper ? 'rgba(62,54,38,0.06)' : 'rgba(255,255,255,0.06)';
  const border = paper ? 'rgba(62,54,38,0.14)' : 'rgba(255,255,255,0.12)';
  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;

  return (
    <View
      style={{
        minHeight: 78,
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 13,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: background,
        borderWidth: 1,
        borderColor: border,
      }}
    >
      <TouchableOpacity
        onPress={() => void togglePlayback()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={playing ? '暂停声音' : '播放声音'}
        style={{
          width: 42,
          height: 42,
          borderRadius: 21,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: paper ? 'rgba(245,194,107,0.34)' : 'rgba(167,155,250,0.18)',
        }}
      >
        {busy ? (
          <ActivityIndicator size="small" color={paper ? '#7A5B22' : '#A79BFA'} />
        ) : (
          <FontAwesome6
            name={playing ? 'pause' : 'play'}
            size={15}
            color={paper ? '#7A5B22' : '#A79BFA'}
          />
        )}
      </TouchableOpacity>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text numberOfLines={1} style={{ fontSize: 13.5, color: ink }}>
          {failed ? '这段声音暂时无法播放' : label}
        </Text>
        <View
          style={{
            height: 3,
            borderRadius: 2,
            marginTop: 9,
            overflow: 'hidden',
            backgroundColor: paper ? 'rgba(62,54,38,0.12)' : 'rgba(255,255,255,0.12)',
          }}
        >
          <View
            style={{
              width: `${progress * 100}%`,
              height: '100%',
              borderRadius: 2,
              backgroundColor: paper ? '#B98433' : '#A79BFA',
            }}
          />
        </View>
        <Text style={{ marginTop: 5, fontSize: 10.5, color: softInk }}>
          {formatMediaDuration(positionMs)}{durationMs > 0 ? ` / ${formatMediaDuration(durationMs)}` : ''}
        </Text>
      </View>
    </View>
  );
}
