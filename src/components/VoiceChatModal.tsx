// src/components/VoiceChatModal.tsx
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { FiX, FiAlertTriangle, FiSearch, FiCode, FiFileText, FiMapPin, FiCompass } from 'react-icons/fi';
import { useChat } from '../contexts/ChatContext';
import { useSettings } from '../contexts/SettingsContext';
import { useNotification } from '../contexts/NotificationContext';
import { API_BASE_URL } from '../utils/api';
import '../css/VoiceChatModal.css';
import Portal from './Portal';
import { getToolDisplayName } from '../utils/toolLabels';

interface VoiceChatModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SPEECH_START_THRESHOLD = 0.004; // Start speaking when above this RMS
const SPEECH_STOP_THRESHOLD = 0.0025; // Consider silence only when below this RMS (hysteresis)
const SILENCE_DURATION_MS = 2000; // Allow short pauses while user is thinking between words
const MIN_RECORDING_MS = 1100; // Require a bit longer minimum capture
const MIN_AUDIO_BYTES = 1200; // Minimum audio size to send
const MIN_SILENT_FRAMES_TO_STOP = 5; // Require sustained silence (prevents threshold jitter flicker)
const MIN_VOICED_FRAMES_TO_START = 4; // Require sustained speech before entering speaking state
const MIN_POST_SPEECH_SILENT_FRAMES_TO_STOP = 120; // Primary turn-end trigger after speech is detected (~2s at 60fps)
const NO_SPEECH_TIMEOUT_MS = 3500; // If speech never starts, stop and wait for next turn
const MAX_RECORDING_MS = 18000; // Hard cap to avoid runaway recordings in noisy environments
const MAX_POST_SPEECH_SILENCE_MS = 2600; // Absolute silence cap once speech has been detected
const DEBUG_VOICE_VAD = true;

const VoiceChatModal = ({ isOpen, onClose }: VoiceChatModalProps) => {
  const [isListening, setIsListening] = useState(false);
  const [isMicReady, setIsMicReady] = useState(false); // triggers re-render when mic is ready
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isThinking, setIsThinking] = useState(false); // UI hint while waiting for assistant
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState({
    instantRms: 0,
    smoothedRms: 0,
    adaptiveStartThreshold: SPEECH_START_THRESHOLD,
    adaptiveStopThreshold: SPEECH_STOP_THRESHOLD,
    noiseFloor: 0,
    silentFrames: 0,
    voicedFrames: 0,
    speechActiveFrames: 0,
    recordingDurationMs: 0,
    silenceDurationMs: 0,
    lastBlobSize: 0,
    lastTranscriptLength: 0,
    hasDetectedSpeech: false,
    stopReason: 'none',
  });
  const [debugEvents, setDebugEvents] = useState<string[]>([]);
  const { sendMessage, messages, isStreaming } = useChat();
  const { user } = useSettings();
  const { showNotification } = useNotification();

  // Kept for potential fallback to browser TTS; not used after switching to ElevenLabs
  // const speechSynthesisRef = useRef<SpeechSynthesisUtterance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef(false);
  const playbackGenerationRef = useRef(0); // increment when we intentionally interrupt playback
  // Playback queue of ready audio URLs; each is played sequentially with no delay
  const playbackQueueRef = useRef<Array<{ url: string; text: string }>>([]);
  const isPlayingQueueRef = useRef(false);
  const ttsServerAvailableRef = useRef(true);
  const pendingTextBufferRef = useRef<string>('');
  const lastAssistantProcessedLenRef = useRef<number>(0);
  const isProcessingRef = useRef(false);
  const lastSpokenMessageIdRef = useRef<string | null>(null);
  // removed awaitingAssistantRef gating; auto-resume is based on concrete end-of-turn signals
  // Per-reply management
  const currentReplyIdRef = useRef<string | null>(null);
  const replyUseFallbackRef = useRef<boolean>(false);
  const spokenSegmentsSetRef = useRef<Set<string>>(new Set());
  // TTS concurrency and cooldown
  const maxConcurrentTts = 2;
  const MIN_TTS_SPACING_MS = 250; // small global delay between provider requests
  const SPEECH_GAP_MS = 200; // gap between spoken segments
  const currentFetchesRef = useRef<number>(0);
  const pendingTtsQueueRef = useRef<Array<{ text: string; replyId: string }>>([]);
  const pumpingRef = useRef<boolean>(false);
  const providerCooldownUntilRef = useRef<number>(0);
  const nextAllowedTtsStartAtRef = useRef<number>(0);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStartTimeRef = useRef<number>(0);
  const lastSoundTimeRef = useRef<number>(0);
  const smoothedRmsRef = useRef<number>(0);
  const silentFramesRef = useRef<number>(0);
  const voicedFramesRef = useRef<number>(0);
  const speechActiveFramesRef = useRef<number>(0);
  const hasDetectedSpeechRef = useRef<boolean>(false);
  const noiseFloorRef = useRef<number>(0.003);
  const lastDebugUiUpdateRef = useRef<number>(0);
  const lastDebugConsoleLogRef = useRef<number>(0);
  const noTranscriptCooldownUntilRef = useRef<number>(0);
  const isTranscribingRef = useRef<boolean>(false);
  const pushDebugEvent = useCallback((event: string, payload?: Record<string, unknown>) => {
    if (!DEBUG_VOICE_VAD) return;
    const ts = new Date().toISOString().slice(11, 23);
    const payloadStr = payload ? ` ${JSON.stringify(payload)}` : '';
    const line = `${ts} ${event}${payloadStr}`;

    setDebugEvents((prev) => [line, ...prev].slice(0, 16));

    try {
      console.warn('[VOICE][VAD]', event, payload || {});
    } catch (_) {}

    try {
      const w = window as unknown as { __LYS_VOICE_DEBUG?: string[] };
      const existing = Array.isArray(w.__LYS_VOICE_DEBUG) ? w.__LYS_VOICE_DEBUG : [];
      w.__LYS_VOICE_DEBUG = [line, ...existing].slice(0, 100);
    } catch (_) {}
  }, []);

  const cleanupResources = useCallback(() => {
    
    
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      } catch (_) {}
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    analyserRef.current = null;
    audioChunksRef.current = [];
  }, []);

  // Convert stage directions to speech-friendly cues
  const sanitizeForTTS = (input: string) => {
    let s = input;
    s = s.replace(/\[(laughs|laughing|chuckles)\]/gi, 'Haha,');
    s = s.replace(/\[(surprised|gasp|gasps)\]/gi, 'Oh!');
    s = s.replace(/\[(sigh|sighs)\]/gi, 'Sigh,');
    s = s.replace(/\[[^\]]+\]/g, '');
    s = s.replace(/\s{2,}/g, ' ').trim();
    return s;
  };

  // Fetch TTS URL for a chunk with retry/backoff to handle rate limits
  const fetchTtsUrl = useCallback(async (text: string): Promise<string> => {
    const token = localStorage.getItem('fexo-token');
    const payload = {
      text: sanitizeForTTS(text),
      voiceId: user?.voiceSettings?.voiceId,
    };
    const attempt = async (delayMs: number) => {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      const response = await fetch(`${API_BASE_URL}/api/voice/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
          ...(token ? { 'x-auth-token': token } : {}),
        },
        body: JSON.stringify(payload),
      });
      return response;
    };
    const backoffs = [0, 600, 1200];
    let lastErr: any = null;
    for (let i = 0; i < backoffs.length; i++) {
      try {
        const res = await attempt(backoffs[i]);
        if (!res.ok) {
          const status = res.status;
          // Try to surface server error json when available
          let serverMsg: string | undefined;
          try {
            const j = await res.json();
            serverMsg = j?.error || j?.detail?.status;
          } catch {}
          if (status === 429 || status >= 500) {
            lastErr = new Error(serverMsg || `TTS failed with ${status}`);
            continue; // retry with next backoff
          } else {
            throw new Error(serverMsg || `TTS request failed (${status})`);
          }
        }
        const arrayBuf = await res.arrayBuffer();
        const blob = new Blob([arrayBuf], { type: 'audio/mpeg' });
        return URL.createObjectURL(blob);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('TTS request failed');
  }, [user?.voiceSettings?.voiceId]);

  const unlockAudioPlayback = useCallback(async () => {
    if (audioUnlockedRef.current) return;
    try {
      // Use Web Audio to unlock audio on user gesture with a 1-frame silent buffer
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
      audioUnlockedRef.current = true;
    } catch (err) {
      // Best-effort unlock; continue even if this fails
    }
  }, []);

  const playUrl = useCallback((url: string) => {
    return new Promise<void>((resolve, reject) => {
      try {
        if (!audioRef.current) {
          audioRef.current = new Audio();
        }
        const myGen = playbackGenerationRef.current;
        const onEnded = () => { cleanup(); resolve(); };
        const onError = (e: any) => {
          if (myGen !== playbackGenerationRef.current) { cleanup(); resolve(); return; }
          cleanup(); reject(e);
        };
        const cleanup = () => {
          audioRef.current?.removeEventListener('ended', onEnded);
          audioRef.current?.removeEventListener('error', onError);
          try { URL.revokeObjectURL(url); } catch {}
        };
        audioRef.current.addEventListener('ended', onEnded);
        audioRef.current.addEventListener('error', onError);
        audioRef.current.src = url;
        audioRef.current.play().catch(onError);
      } catch (e) {
        reject(e);
      }
    });
  }, []);

  const enqueuePlaybackUrl = useCallback((url: string, text: string) => {
    playbackQueueRef.current.push({ url, text });
    // Kick playback loop
    (async () => {
      if (isPlayingQueueRef.current) return;
      isPlayingQueueRef.current = true;
      try {
        while (playbackQueueRef.current.length > 0) {
          const { url } = playbackQueueRef.current.shift()!;
          setIsSpeaking(true);
          setIsThinking(false); // no longer thinking once we start speaking
          try {
            await playUrl(url);
          } catch (err) {
          }
          // small, natural pause between segments
          if (SPEECH_GAP_MS > 0) {
            await new Promise((r) => setTimeout(r, SPEECH_GAP_MS));
          }
        }
      } finally {
        isPlayingQueueRef.current = false;
  setIsSpeaking(false);
      }
    })();
  }, [playUrl]);

  const segmentKey = useCallback((text: string) => `${text.length}:${text.slice(0, 64)}`, []);

  const enqueueSpeechFallback = useCallback((text: string) => {
    // Queue a SpeechSynthesis utterance to mimic sequential playback
    const makeUtter = (t: string) => {
      const u = new SpeechSynthesisUtterance(t);
      u.rate = 1.0;
      u.pitch = 1.0;
      return u;
    };
  const utter = makeUtter(text);
  utter.onstart = () => { setIsSpeaking(true); setIsThinking(false); };
    utter.onend = () => { setIsSpeaking(false); };
    utter.onerror = () => { setIsSpeaking(false); };
    window.speechSynthesis.speak(utter);
  }, []);

  const pumpTtsQueue = useCallback(() => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    const step = async () => {
      try {
        while (
          pendingTtsQueueRef.current.length > 0 &&
          currentFetchesRef.current < maxConcurrentTts
        ) {
          const nextItem = pendingTtsQueueRef.current[0];
          const text = nextItem?.text || '';
          if (!text.trim()) { pendingTtsQueueRef.current.shift(); continue; }

          const now = Date.now();
          const providerUnavailable =
            replyUseFallbackRef.current ||
            !ttsServerAvailableRef.current ||
            now < providerCooldownUntilRef.current;

          if (providerUnavailable) {
            // Use fallback immediately for this segment
            pendingTtsQueueRef.current.shift();
            const key = segmentKey(text);
            if (!spokenSegmentsSetRef.current.has(key)) {
              spokenSegmentsSetRef.current.add(key);
              enqueueSpeechFallback(text);
            }
            continue;
          }

          // Enforce global spacing between provider requests
          if (now < nextAllowedTtsStartAtRef.current) {
            const delay = Math.max(0, nextAllowedTtsStartAtRef.current - now);
            setTimeout(() => {
              pumpingRef.current = false;
              pumpTtsQueue();
            }, delay);
            return;
          }

          // Start provider request for this item
          const { replyId: itemReplyId } = nextItem;
          pendingTtsQueueRef.current.shift();
          currentFetchesRef.current += 1;
          nextAllowedTtsStartAtRef.current = Date.now() + MIN_TTS_SPACING_MS;
          (async () => {
            try {
              const url = await fetchTtsUrl(text);
              const key = segmentKey(text);
              // Discard if reply changed while fetching
              if (itemReplyId !== currentReplyIdRef.current) {
                try { URL.revokeObjectURL(url); } catch {}
              } else if (!spokenSegmentsSetRef.current.has(key)) {
                enqueuePlaybackUrl(url, text);
              } else {
                try { URL.revokeObjectURL(url); } catch {}
              }
            } catch (err: any) {
              const msg = String(err?.message || '');
              if (msg.includes('401') || msg.includes('403') || msg.toLowerCase().includes('unauthor')) {
                ttsServerAvailableRef.current = false;
                replyUseFallbackRef.current = true;
                setVoiceError('Slow down! Our voice service is experiencing rate exceed. Please try again later.');
                const key = segmentKey(text);
                if (!spokenSegmentsSetRef.current.has(key)) {
                  spokenSegmentsSetRef.current.add(key);
                  enqueueSpeechFallback(text);
                }
              } else if (msg.includes('429') || msg.includes('Too Many') || msg.includes('concurrent')) {
                providerCooldownUntilRef.current = Date.now() + 2000;
                setVoiceError('Slow down! Our voice service is experiencing rate exceed. Please try again later.');
                const key = segmentKey(text);
                if (!spokenSegmentsSetRef.current.has(key)) {
                  spokenSegmentsSetRef.current.add(key);
                  enqueueSpeechFallback(text);
                }
              } else {
                const emsg = String(err?.message || '').toLowerCase();
                if (emsg.includes('500') || emsg.includes('internal') || emsg.includes('server')) {
                  setVoiceError('Slow down! Our voice service is experiencing rate exceed. Please try again later.');
                }
                const key = segmentKey(text);
                if (!spokenSegmentsSetRef.current.has(key)) {
                  spokenSegmentsSetRef.current.add(key);
                  enqueueSpeechFallback(text);
                }
              }
            } finally {
              currentFetchesRef.current -= 1;
              if (pendingTtsQueueRef.current.length > 0) {
                step();
              } else {
                pumpingRef.current = false;
              }
            }
          })();
        }
      } finally {
        if (
          pendingTtsQueueRef.current.length === 0 &&
          currentFetchesRef.current === 0
        ) {
          pumpingRef.current = false;
        }
      }
    };
    step();
  }, [enqueuePlaybackUrl, enqueueSpeechFallback, fetchTtsUrl, segmentKey, showNotification]);

  const fetchAndQueueTts = useCallback((text: string) => {
    const replyId = currentReplyIdRef.current || 'default';
    pendingTtsQueueRef.current.push({ text, replyId });
    pumpTtsQueue();
  }, [pumpTtsQueue]);

  // Deprecated chunk queue retained for reference; no longer used since we speak once per reply

  // Deprecated: queue processor no longer used with single-shot TTS

  // Deprecated: chunked enqueue no longer used (single-shot TTS per reply)

  const handleClose = useCallback(() => {
    // Force stop any ongoing speech synthesis and audio playback
    try { if (window.speechSynthesis.speaking) window.speechSynthesis.cancel(); } catch {}
    try {
      if (audioRef.current) {
        const src = audioRef.current.src;
        audioRef.current.pause();
        audioRef.current.src = '';
        playbackGenerationRef.current += 1; // mark intentional interruption
        if (src && src.startsWith('blob:')) { try { URL.revokeObjectURL(src); } catch {} }
      }
    } catch {}

    // Revoke any queued blob URLs and clear queues
    try {
      for (const item of playbackQueueRef.current) {
        const u = item.url;
        if (u && u.startsWith('blob:')) { try { URL.revokeObjectURL(u); } catch {} }
      }
    } catch {}
    playbackQueueRef.current = [];
    pendingTtsQueueRef.current = [];
    spokenSegmentsSetRef.current.clear();
    ttsServerAvailableRef.current = true;
    replyUseFallbackRef.current = false;
    pendingTextBufferRef.current = '';
    lastAssistantProcessedLenRef.current = 0;

    cleanupResources();
    setIsListening(false);
    setIsSpeaking(false);
    setIsRecording(false);
    setIsMicReady(false);
    lastSpokenMessageIdRef.current = null;

    onClose();
  }, [cleanupResources, onClose]);

  const transcribeAudioBlob = useCallback(async (blob: Blob) => {
    
    const token = localStorage.getItem('fexo-token');
    const formData = new FormData();
    formData.append('audio', blob, `voice-${Date.now()}.webm`);

    const headers: Record<string, string> = {};
    if (token) {
      headers['x-auth-token'] = token;
    }

    const response = await fetch(`${API_BASE_URL}/api/voice/transcribe`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      let message = 'Failed to transcribe audio.';
      if (errorData?.error) {
        if (typeof errorData.error === 'string') {
          message = errorData.error;
        } else if (typeof errorData.error === 'object') {
          try { message = JSON.stringify(errorData.error); } catch {}
        }
      } else if (errorData?.detail?.message) {
        message = errorData.detail.message;
      }
      const status = response.status;
      const quotaExceeded =
        errorData?.detail?.status === 'quota_exceeded' ||
        errorData?.error?.detail?.status === 'quota_exceeded' ||
        /quota|rate|exceed/i.test(String(message));
      if (status === 401 || status === 403 || status === 429 || status >= 500 || quotaExceeded) {
        setVoiceError('Slow down! Our voice service is experiencing rate exceed. Please try again later.');
      }
      throw new Error(message);
    }

    const data = await response.json();
    return (data?.transcript as string) || '';
  }, []);

  const handleUserSpeech = useCallback(async (text: string) => {
    
    if (isProcessingRef.current || !text.trim()) {
      
      return;
    }

    
    isProcessingRef.current = true;
    setIsListening(false);
    setIsThinking(true);
    pushDebugEvent('sendMessage_start', { textLen: text.trim().length });
    

    try {
      await sendMessage(text, [], { isThinkingEnabled: false, voiceMode: true });
      pushDebugEvent('sendMessage_done');
    } catch (error) {
      pushDebugEvent('sendMessage_error', { message: String(error instanceof Error ? error.message : error || '') });
      showNotification('Failed to send message', 'error');
    } finally {
      isProcessingRef.current = false;
    }
  }, [pushDebugEvent, sendMessage, showNotification]);

  const stopRecording = useCallback((reason: string = 'manual') => {
    
    
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      
      mediaRecorderRef.current.stop();
    }

    if (DEBUG_VOICE_VAD) {
      setDebugInfo((prev) => ({ ...prev, stopReason: reason }));
      pushDebugEvent('stopRecording', {
        reason,
        hasDetectedSpeech: hasDetectedSpeechRef.current,
        speechActiveFrames: speechActiveFramesRef.current,
        silentFrames: silentFramesRef.current,
        voicedFrames: voicedFramesRef.current,
        noiseFloor: noiseFloorRef.current,
      });
    }

    if (reason === 'no_speech_timeout') {
      setIsThinking(false);
      noTranscriptCooldownUntilRef.current = Date.now() + 1500;
      pushDebugEvent('no_speech_timeout_cooldown', { untilMs: noTranscriptCooldownUntilRef.current });
    }

    // Do not force listening while stopped; auto-restart effect decides when to listen again.
    setIsListening(false);
    setIsRecording(false);
  }, [pushDebugEvent]);

  const monitorAudioLevels = useCallback(() => {
    if (!analyserRef.current) return;

    const analyser = analyserRef.current;
    const dataArray = new Float32Array(analyser.fftSize);

    const checkLevel = () => {
      if (!analyserRef.current || !mediaRecorderRef.current) return;

      analyser.getFloatTimeDomainData(dataArray);

      // Calculate RMS (root mean square) to determine volume level
      let sumSquares = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sumSquares += dataArray[i] * dataArray[i];
      }
      const instantRms = Math.sqrt(sumSquares / dataArray.length);
      // Exponential smoothing to stabilize detection
      const alpha = 0.08; // smoothing factor
      const prev = smoothedRmsRef.current || 0;
      const smoothed = prev + alpha * (instantRms - prev);
      smoothedRmsRef.current = smoothed;

      const now = performance.now();
      const recordingDuration = now - recordingStartTimeRef.current;

      // Learn ambient noise floor slowly until speech starts.
      if (!hasDetectedSpeechRef.current && voicedFramesRef.current === 0) {
        const boundedInstant = Math.min(instantRms, Math.max(0.012, noiseFloorRef.current * 1.35));
        noiseFloorRef.current = noiseFloorRef.current * 0.96 + boundedInstant * 0.04;
      }

      const clampedNoiseFloor = Math.min(noiseFloorRef.current, 0.03);
      const adaptiveStartThreshold = Math.max(SPEECH_START_THRESHOLD, clampedNoiseFloor * 2.0 + 0.003);
      const adaptiveStopThreshold = Math.max(SPEECH_STOP_THRESHOLD, clampedNoiseFloor * 1.5 + 0.0015);

      if (DEBUG_VOICE_VAD) {
        if (now - lastDebugUiUpdateRef.current > 180) {
          lastDebugUiUpdateRef.current = now;
          setDebugInfo((prev) => ({
            ...prev,
            instantRms,
            smoothedRms: smoothed,
            adaptiveStartThreshold,
            adaptiveStopThreshold,
            noiseFloor: noiseFloorRef.current,
            silentFrames: silentFramesRef.current,
            voicedFrames: voicedFramesRef.current,
            speechActiveFrames: speechActiveFramesRef.current,
            recordingDurationMs: recordingDuration,
            silenceDurationMs: now - lastSoundTimeRef.current,
            hasDetectedSpeech: hasDetectedSpeechRef.current,
          }));
        }

        if (now - lastDebugConsoleLogRef.current > 1000) {
          lastDebugConsoleLogRef.current = now;
          pushDebugEvent('metrics', {
            instantRms,
            smoothedRms: smoothed,
            adaptiveStartThreshold,
            adaptiveStopThreshold,
            noiseFloor: noiseFloorRef.current,
            silentFrames: silentFramesRef.current,
            voicedFrames: voicedFramesRef.current,
            speechActiveFrames: speechActiveFramesRef.current,
            recordingDurationMs: Math.round(recordingDuration),
            silenceDurationMs: Math.round(now - lastSoundTimeRef.current),
            hasDetectedSpeech: hasDetectedSpeechRef.current,
            isRecording: mediaRecorderRef.current?.state,
          });
        }
      }

      if (!hasDetectedSpeechRef.current && recordingDuration > NO_SPEECH_TIMEOUT_MS) {
        stopRecording('no_speech_timeout');
        return;
      }

      if (recordingDuration > MAX_RECORDING_MS) {
        stopRecording('max_recording_timeout');
        return;
      }

      const silenceDuration = now - lastSoundTimeRef.current;
      if (hasDetectedSpeechRef.current && silenceDuration > MAX_POST_SPEECH_SILENCE_MS) {
        stopRecording('max_post_speech_silence');
        return;
      }

      // Detection phase: wait for sustained speech above start threshold.
      if (!hasDetectedSpeechRef.current) {
        if (smoothed > adaptiveStartThreshold) {
          voicedFramesRef.current += 1;
          if (voicedFramesRef.current >= MIN_VOICED_FRAMES_TO_START) {
            hasDetectedSpeechRef.current = true;
            silentFramesRef.current = 0;
            speechActiveFramesRef.current = 0;
            lastSoundTimeRef.current = now;
          }
        } else {
          // Decay counter instead of hard reset so short jitter doesn't lose detection progress.
          voicedFramesRef.current = Math.max(0, voicedFramesRef.current - 1);
        }
      } else {
        // Post-detection phase: any energy above stop threshold is still considered ongoing speech.
        if (smoothed > adaptiveStopThreshold) {
          lastSoundTimeRef.current = now;
          silentFramesRef.current = 0;
          speechActiveFramesRef.current += 1;
          if (smoothed > adaptiveStartThreshold) {
            voicedFramesRef.current += 1;
          }
        } else {
          silentFramesRef.current += 1;
          if (
            recordingDuration > MIN_RECORDING_MS &&
            silentFramesRef.current >= MIN_POST_SPEECH_SILENT_FRAMES_TO_STOP
          ) {
            stopRecording('silence_frames_trigger');
            return;
          }

          if (
            recordingDuration > MIN_RECORDING_MS &&
            silenceDuration > SILENCE_DURATION_MS &&
            silentFramesRef.current >= MIN_SILENT_FRAMES_TO_STOP
          ) {
            stopRecording('silence_detected');
            return;
          }
        }
      }

      animationFrameRef.current = requestAnimationFrame(checkLevel);
    };

    animationFrameRef.current = requestAnimationFrame(checkLevel);
  }, [pushDebugEvent, stopRecording]);

  const startRecording = useCallback(async () => {
    if (!mediaStreamRef.current || isRecording || isSpeaking || isProcessingRef.current || isTranscribingRef.current) {
      return;
    }

    
    audioChunksRef.current = [];
    recordingStartTimeRef.current = performance.now();
    lastSoundTimeRef.current = performance.now();
    smoothedRmsRef.current = 0;
    silentFramesRef.current = 0;
    voicedFramesRef.current = 0;
    speechActiveFramesRef.current = 0;
    hasDetectedSpeechRef.current = false;
    noiseFloorRef.current = Math.max(0.0015, noiseFloorRef.current * 0.9);
    lastDebugUiUpdateRef.current = 0;
    lastDebugConsoleLogRef.current = 0;
    if (DEBUG_VOICE_VAD) {
      setDebugInfo((prev) => ({
        ...prev,
        instantRms: 0,
        smoothedRms: 0,
        adaptiveStartThreshold: SPEECH_START_THRESHOLD,
        adaptiveStopThreshold: SPEECH_STOP_THRESHOLD,
        noiseFloor: noiseFloorRef.current,
        silentFrames: 0,
        voicedFrames: 0,
        speechActiveFrames: 0,
        recordingDurationMs: 0,
        silenceDurationMs: 0,
        lastBlobSize: 0,
        lastTranscriptLength: 0,
        hasDetectedSpeech: false,
        stopReason: 'recording_started',
      }));
      pushDebugEvent('recording_started', {
        noiseFloor: noiseFloorRef.current,
      });
    }

    // Set up MediaRecorder
    const mimeTypesToTry = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];

    let selectedMimeType = '';
    for (const mime of mimeTypesToTry) {
      if (MediaRecorder.isTypeSupported(mime)) {
        selectedMimeType = mime;
        break;
      }
    }

    const recorder = new MediaRecorder(
      mediaStreamRef.current,
      selectedMimeType ? { mimeType: selectedMimeType } : undefined
    );
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };

    recorder.onstop = async () => {
      
      const chunks = audioChunksRef.current;
      audioChunksRef.current = [];

      if (chunks.length === 0 || isProcessingRef.current) {
        
        return;
      }

      if (!hasDetectedSpeechRef.current) {
        return;
      }

      const blob = new Blob(chunks, { type: recorder.mimeType });
      if (DEBUG_VOICE_VAD) {
        pushDebugEvent('blob_ready', { size: blob.size, mimeType: recorder.mimeType });
        setDebugInfo((prev) => ({ ...prev, lastBlobSize: blob.size }));
      }
      

      if (blob.size < MIN_AUDIO_BYTES) {
        if (DEBUG_VOICE_VAD) {
          setDebugInfo((prev) => ({ ...prev, stopReason: 'audio_too_small' }));
        }
        
        return;
      }

      isTranscribingRef.current = true;
      pushDebugEvent('transcribe_start', { blobSize: blob.size });
      try {
        const text = await transcribeAudioBlob(blob);
        if (DEBUG_VOICE_VAD) {
          pushDebugEvent('transcript_result', { length: (text || '').trim().length });
          setDebugInfo((prev) => ({ ...prev, lastTranscriptLength: (text || '').trim().length }));
        }
        if (text && text.trim()) {
          await handleUserSpeech(text);
        } else {
          setIsThinking(false);
          noTranscriptCooldownUntilRef.current = Date.now() + 2500;
          if (DEBUG_VOICE_VAD) {
            setDebugInfo((prev) => ({ ...prev, stopReason: 'empty_transcript' }));
            pushDebugEvent('empty_transcript_cooldown', { untilMs: noTranscriptCooldownUntilRef.current });
          }
          
        }
      } catch (error) {
        const msg = String(error instanceof Error ? error.message : error || '');
        setIsThinking(false);
        noTranscriptCooldownUntilRef.current = Date.now() + 2500;
        pushDebugEvent('transcribe_error', { message: msg, untilMs: noTranscriptCooldownUntilRef.current });
        const isRate = /quota|rate|exceed|429|unauthorized|401|403/i.test(msg);
        if (isRate) {
          // voiceError is set inside transcribeAudioBlob; avoid noisy toast
        } else {
          showNotification(msg || 'Failed to transcribe audio.', 'error');
        }
      } finally {
        isTranscribingRef.current = false;
        pushDebugEvent('transcribe_done');
      }
    };

    recorder.start(400); // Collect data every 400ms
    setIsRecording(true);
    setIsListening(true);
    

    // Start monitoring audio levels for silence detection
    monitorAudioLevels();
  }, [isRecording, isSpeaking, transcribeAudioBlob, handleUserSpeech, showNotification, monitorAudioLevels, pushDebugEvent]);

  // Initialize audio context and microphone
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let cancelled = false;

    const setup = async () => {
      try {
        
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            noiseSuppression: true,
            echoCancellation: true,
            autoGainControl: true,
            channelCount: 1,
            sampleRate: 16000,
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

  mediaStreamRef.current = stream;
  setIsMicReady(true);

        // Set up audio context and analyser
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const highPass = audioContext.createBiquadFilter();
        highPass.type = 'highpass';
        highPass.frequency.value = 120;
        highPass.Q.value = 0.707;
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(highPass);
        highPass.connect(analyser);

        audioContextRef.current = audioContext;
        analyserRef.current = analyser;

        
      } catch (error) {
        showNotification('Microphone access is required for voice chat.', 'error');
        onClose();
      }
    };

    setup();

    return () => {
      cancelled = true;
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch (_) {}
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      setIsMicReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Stop recording while assistant is actively responding (streaming) or speaking
  useEffect(() => {
    if (!isOpen || !isRecording) return;
    // If TTS playback is ongoing, avoid recording to prevent feedback
    if (isSpeaking) {
      stopRecording('assistant_speaking');
      return;
    }
    // If assistant stream is active (deltas incoming), stop until reply finishes
    if (isStreaming && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'assistant') {
        stopRecording('assistant_streaming');
      }
    }
  }, [isOpen, isRecording, isSpeaking, isStreaming, messages, stopRecording]);

  // After assistant finishes speaking and streaming, automatically resume listening
  useEffect(() => {
    if (!isOpen) return;
    const ready =
      !isSpeaking &&
      !isStreaming &&
      isMicReady &&
      !isRecording &&
      !isProcessingRef.current &&
      !isTranscribingRef.current &&
      playbackQueueRef.current.length === 0 &&
      pendingTtsQueueRef.current.length === 0 &&
      currentFetchesRef.current === 0 &&
      pendingTextBufferRef.current.trim().length === 0 &&
      Date.now() >= noTranscriptCooldownUntilRef.current;
    let t: number | undefined;
    if (ready) {
      // small cooldown to avoid rapid start/stop oscillation
      t = window.setTimeout(() => {
        startRecording();
      }, 350);
    }
    return () => { if (t) window.clearTimeout(t); };
  }, [isSpeaking, isStreaming, isOpen, isMicReady, isRecording, startRecording]);

  // Idle watchdog: refs in ready conditions can change without causing re-render, so retry start periodically.
  useEffect(() => {
    if (!isOpen) return;

    const tick = window.setInterval(() => {
      const ready =
        !isSpeaking &&
        !isStreaming &&
        isMicReady &&
        !isRecording &&
        !isProcessingRef.current &&
        !isTranscribingRef.current &&
        playbackQueueRef.current.length === 0 &&
        pendingTtsQueueRef.current.length === 0 &&
        currentFetchesRef.current === 0 &&
        pendingTextBufferRef.current.trim().length === 0 &&
        Date.now() >= noTranscriptCooldownUntilRef.current;

      if (ready) {
        startRecording();
      }
    }, 700);

    return () => window.clearInterval(tick);
  }, [isMicReady, isOpen, isRecording, isSpeaking, isStreaming, startRecording]);

  // Stream assistant deltas into finalized chunks; for each chunk, immediately request TTS and queue the audio for playback
  useEffect(() => {
    if (!isOpen || messages.length === 0) return;
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== 'assistant') return;
    const content = lastMessage.content || '';

    // Reset counters when a new assistant reply starts (content shrank)
    if (content.length < lastAssistantProcessedLenRef.current) {
      // New assistant reply started
      pendingTextBufferRef.current = '';
      lastAssistantProcessedLenRef.current = 0;
      currentReplyIdRef.current = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      replyUseFallbackRef.current = false;
      spokenSegmentsSetRef.current.clear();
      // Interrupt any ongoing playback from previous reply and clear queued items
      try { if (window.speechSynthesis.speaking) window.speechSynthesis.cancel(); } catch {}
      try {
        if (audioRef.current) {
          const src = audioRef.current.src;
          audioRef.current.pause();
          audioRef.current.src = '';
          playbackGenerationRef.current += 1;
          if (src && src.startsWith('blob:')) { try { URL.revokeObjectURL(src); } catch {} }
        }
      } catch {}
      playbackQueueRef.current = [];
      pendingTtsQueueRef.current = [];
    }
    if (!currentReplyIdRef.current) {
      currentReplyIdRef.current = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    if (content.length > lastAssistantProcessedLenRef.current) {
      const delta = content.substring(lastAssistantProcessedLenRef.current);
      pendingTextBufferRef.current += delta;
      lastAssistantProcessedLenRef.current = content.length;

  // Finalize chunks on strong punctuation or if buffer is long to reduce latency
      const segments: string[] = [];
      const regex = /(.*?[\.!\?])(\s|$)/g;
      let match;
      let consumed = 0;
      while ((match = regex.exec(pendingTextBufferRef.current)) !== null) {
        const seg = match[1].trim();
        if (seg) segments.push(seg);
        consumed = regex.lastIndex;
      }
      // If no sentence end yet but buffer is long, flush mid-chunk to keep audio flowing
      if (segments.length === 0 && pendingTextBufferRef.current.length > 260) {
        const cut = pendingTextBufferRef.current.slice(0, 260);
        const lastSpace = cut.lastIndexOf(' ');
        const seg = cut.slice(0, lastSpace > 140 ? lastSpace : cut.length).trim();
        if (seg) {
          segments.push(seg);
          consumed = seg.length;
        }
      }

      if (segments.length > 0) {
        pendingTextBufferRef.current = pendingTextBufferRef.current.slice(consumed);
        // Fire TTS requests immediately; playback will start as audio becomes ready
        for (const seg of segments) {
          fetchAndQueueTts(seg);
        }
      }
    }
  }, [messages, isOpen, fetchAndQueueTts]);

  // Flush any leftover text at end of streaming
  useEffect(() => {
    if (!isOpen) return;
    if (isStreaming) return;
    const leftover = pendingTextBufferRef.current.trim();
    if (leftover) {
      pendingTextBufferRef.current = '';
      fetchAndQueueTts(leftover);
    }
    // No additional gating; auto-restart effect handles readiness
  }, [isOpen, isStreaming, fetchAndQueueTts]);

  const latestToolIndicator = useMemo(() => {
    if (!messages || messages.length === 0) return null;

    const lastUserIndex = [...messages].findLastIndex((m) => m.role === 'user');
    if (lastUserIndex < 0) return null;

    let latestTool: any = null;
    for (let i = lastUserIndex + 1; i < messages.length; i++) {
      const m: any = messages[i];
      if (m.role === 'user') break;
      if (typeof m.role === 'string' && m.role.startsWith('tool_') && !m.role.endsWith('_result')) {
        latestTool = m;
      }
    }

    if (!latestTool?.role) return null;

    const role = latestTool.role as string;
    const state = latestTool.state || 'executing';
    const detail =
      state === 'error'
        ? 'Failed'
        : state === 'completed' || state === 'searched'
          ? 'Used'
          : 'Using';

    let kind: 'search' | 'code' | 'doc' | 'geo' | 'integration' = 'integration';
    if (role === 'tool_search') kind = 'search';
    else if (role === 'tool_code') kind = 'code';
    else if (role === 'tool_doc_extract') kind = 'doc';
    else if (role === 'tool_geolocation') kind = 'geo';

    return {
      id: latestTool.tool_id || role,
      kind,
      label: getToolDisplayName(role),
      detail,
      state,
    };
  }, [messages]);

  const showToolChip = Boolean(
    latestToolIndicator &&
    (isStreaming || isThinking || ['writing', 'ready_to_execute', 'executing', 'searching', 'analyzing'].includes(latestToolIndicator.state))
  );

  const toolChipIcon = useMemo(() => {
    if (!latestToolIndicator) return <FiCompass size={18} />;
    if (latestToolIndicator.kind === 'search') return <FiSearch size={18} />;
    if (latestToolIndicator.kind === 'code') return <FiCode size={18} />;
    if (latestToolIndicator.kind === 'doc') return <FiFileText size={18} />;
    if (latestToolIndicator.kind === 'geo') return <FiMapPin size={18} />;
    return <FiCompass size={18} />;
  }, [latestToolIndicator]);

  // Mic toggling handled automatically; no manual toggle button is shown.

  // Debug sample button removed

  if (!isOpen) return null;

  let statusText = 'Initializing microphone...';
  let statusClass = 'idle';

  if (isMicReady) {
    if (isSpeaking) {
      statusText = 'Speaking...';
      statusClass = 'speaking';
    } else if (isStreaming) {
      statusText = 'Assistant is working...';
      statusClass = 'listening';
    } else if (isRecording) {
      statusText = 'Recording... (speak now)';
      statusClass = 'listening';
    } else if (isThinking) {
      statusText = 'Thinking...';
      statusClass = 'listening';
    } else if (isListening && !isRecording) {
      statusText = 'Processing...';
      statusClass = 'listening';
    } else {
      statusText = 'Say something to start';
      statusClass = 'idle';
    }
  }

  return (
    <Portal>
      <div className="voice-chat-overlay">
        <div className="voice-chat-modal" onClick={(e) => e.stopPropagation()}>
        <button className="voice-chat-close-btn" onClick={handleClose}>
          <FiX size={24} />
        </button>

        <div className="voice-chat-content">
          <div className={`ai-orb ${isSpeaking ? 'speaking' : ''} ${(isRecording || isListening || isThinking || isStreaming) ? 'listening' : ''}`}>
            <div className="orb-inner"></div>
            <div className="orb-glow"></div>
          </div>

          <div className="voice-chat-status">
            <p className={`status-text ${statusClass}`}>{statusText}</p>
          </div>

          {DEBUG_VOICE_VAD && (
            <div className="voice-debug-panel">
              <h4>Voice Debug</h4>
              <div className="voice-debug-grid">
                <div><span>instantRMS</span><strong>{debugInfo.instantRms.toFixed(4)}</strong></div>
                <div><span>smoothedRMS</span><strong>{debugInfo.smoothedRms.toFixed(4)}</strong></div>
                <div><span>startThr</span><strong>{debugInfo.adaptiveStartThreshold.toFixed(4)}</strong></div>
                <div><span>stopThr</span><strong>{debugInfo.adaptiveStopThreshold.toFixed(4)}</strong></div>
                <div><span>noiseFloor</span><strong>{debugInfo.noiseFloor.toFixed(4)}</strong></div>
                <div><span>voicedFrames</span><strong>{debugInfo.voicedFrames}</strong></div>
                <div><span>speechFrames</span><strong>{debugInfo.speechActiveFrames}</strong></div>
                <div><span>silentFrames</span><strong>{debugInfo.silentFrames}</strong></div>
                <div><span>duration</span><strong>{Math.round(debugInfo.recordingDurationMs)} ms</strong></div>
                <div><span>silence</span><strong>{Math.round(debugInfo.silenceDurationMs)} ms</strong></div>
                <div><span>blobSize</span><strong>{debugInfo.lastBlobSize} B</strong></div>
                <div><span>transcriptLen</span><strong>{debugInfo.lastTranscriptLength}</strong></div>
                <div><span>speechDetected</span><strong>{debugInfo.hasDetectedSpeech ? 'yes' : 'no'}</strong></div>
                <div><span>stopReason</span><strong>{debugInfo.stopReason}</strong></div>
              </div>
              <div className="voice-debug-events">
                <h5>Latest Events</h5>
                <ul>
                  {debugEvents.map((event, idx) => (
                    <li key={`${idx}-${event}`}>{event}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

            {/* Caption removed as requested */}

          <div className="voice-chat-controls">
            <div
              className={`voice-dots ${isThinking ? 'thinking' : ''}`}
              onClick={() => unlockAudioPlayback().catch(() => {})}
              role="button"
              aria-label="Speech status indicator"
              title="Speech status"
            >
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </div>
          </div>

          <div className="voice-tool-chip-wrap" aria-live="polite">
            <div
              className={`voice-tool-chip ${showToolChip ? 'visible' : ''} ${latestToolIndicator?.kind || 'integration'}`}
              role="status"
            >
              <div className="voice-tool-chip-icon">{toolChipIcon}</div>
              <div className="voice-tool-chip-labels">
                <span>{latestToolIndicator?.detail || 'Using'}</span>
                <strong>{latestToolIndicator?.label || 'Tool'}</strong>
              </div>
            </div>
          </div>

          <div className="voice-chat-info">
            <p className="info-text">
              Ask me anything - I can search the internet, execute code, find directions, and more!
            </p>
          </div>
          {/* Debug button removed */}
          {voiceError && (
            <div className="voice-error-backdrop" role="dialog" aria-modal="true" aria-label="Voice service error">
              <div className="voice-error-card">
                <div className="voice-error-icon"><FiAlertTriangle size={28} /></div>
                <h3 className="voice-error-title">Slow down</h3>
                <p className="voice-error-message">Our voice service is experiencing rate exceed. Please try again later.</p>
                <div className="voice-error-actions">
                  <button className="voice-error-button" onClick={() => { setVoiceError(null); handleClose(); }}>Got it</button>
                </div>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>
    </Portal>
  );
};

export default VoiceChatModal;
