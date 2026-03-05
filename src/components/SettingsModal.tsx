import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../contexts/SettingsContext';
import { useNotification } from '../contexts/NotificationContext';
import '../css/SettingsModal.css';
import { FiRefreshCw, FiCpu, FiSliders, FiEye, FiEyeOff, FiMoreVertical, FiX, FiCreditCard, FiCheckCircle, FiLink, FiStar, FiVolume2, FiPlay, FiPause, FiChevronDown, FiChevronRight, FiTrash2, FiEdit2 } from "react-icons/fi";
import OpenAIIcon from '../icons/openai.svg?react';
import AnthropicIcon from '../icons/anthropic.svg?react';
import GeminiIcon from '../icons/gemini.svg?react';
import api from '../utils/api';
import Tooltip from './Tooltip';
import Portal from './Portal';
import { type Provider } from './ProviderSelector';
import '../css/VoiceSettings.css';

type Model = { id: string };
type ProviderModelEntry = { id: string; provider: string };
type Modality = 'text' | 'image' | 'code' | 'reasoning';
type ModelConfig = { id: string; provider?: string; modalities: Modality[]; };
type ApiKeyEntry = { provider: string; key: string; };
type ProviderConfig = {
  provider: string;
  baseUrl: string;
  enabled: boolean;
  contextLength: number;
  maxOutputTokens: number;
};
type GptSection = 'general' | `provider:${string}`;

type Integration = {
  id: string;
  name: string;
  description: string;
};

type VoiceOption = {
  id: string;
  name: string;
  description: string;
  gender: 'male' | 'female';
  previewText: string;
};

interface SettingsModalProps { isOpen: boolean; onClose: () => void; }
type ActiveTab = 'GPT' | 'Subscription' | 'Appearance' | 'Integrations' | 'Voice';

const providers: Provider[] = [
  { id: 'default', name: "Default (Free)",Icon: GeminiIcon},
  { id: 'openai', name: 'OpenAI', Icon: OpenAIIcon },
  { id: 'anthropic', name: 'Anthropic', Icon: AnthropicIcon },
  { id: 'gemini', name: 'Gemini', Icon: GeminiIcon },
];
const baseProviderIds = new Set(providers.map((provider) => provider.id));

const MIN_CONTEXT = 4096;
const MAX_CONTEXT = 1000000;
const MIN_OUTPUT_TOKENS = 256;
const MAX_OUTPUT_TOKENS = 64000;

const freeFeatures = [
  'Unlimited chats with shared free model',
  'Core chat features',
  'Basic settings and personalization',
];

const proFeatures = [
  'Bring-your-own API keys and provider controls',
  'Voice transcription and text-to-speech',
  'Tool integrations in chat',
  'Priority access and higher quality outputs',
];

const voiceOptions: VoiceOption[] = [
  {
    id: '21m00Tcm4TlvDq8ikWAM',
    name: 'Rachel',
    description: 'Warm and expressive, great for conversational responses.',
    gender: 'female',
    previewText: 'Hi, this is Rachel. I can read your assistant replies aloud.',
  },
  {
    id: 'AZnzlk1XvdvUeBnXmlld',
    name: 'Domi',
    description: 'Confident and energetic voice for punchy playback.',
    gender: 'female',
    previewText: 'Hello from Domi. Let me read this answer with more punch.',
  },
  {
    id: 'TxGEqnHWrfWFTfGW9XjX',
    name: 'Josh',
    description: 'Balanced male voice suited for everyday narration.',
    gender: 'male',
    previewText: 'Hey there, I am Josh. This is a quick preview of voice output.',
  },
  {
    id: 'VR6AewLTigWG4xSOukaG',
    name: 'Arnold',
    description: 'Deeper, assertive male voice for strong emphasis.',
    gender: 'male',
    previewText: 'This is Arnold speaking. Your AI responses can sound like this.',
  },
];

const SettingsModal = ({ isOpen, onClose }: SettingsModalProps) => {
  const { user, updateSettings, theme, setTheme } = useSettings();
  const { showNotification } = useNotification();
  const navigate = useNavigate();
  
  const [activeTab, setActiveTab] = useState<ActiveTab>('GPT');
  const [isClosing, setIsClosing] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState(user?.selectedProvider || 'default');
  const [apiKeys, setApiKeys] = useState<ApiKeyEntry[]>(user?.apiKeys || []);
  const [baseUrl, setBaseUrl] = useState(user?.baseUrl || '');
  const [providerConfigs, setProviderConfigs] = useState<ProviderConfig[]>([]);
  const [selectedModel, setSelectedModel] = useState(user?.selectedModel || '');
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [providerModels, setProviderModels] = useState<Record<string, Model[]>>({});
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const [openConfigMenuId, setOpenConfigMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });

  const [quickAccessModels, setQuickAccessModels] = useState<string[]>(user?.quickAccessModels || []);
  const [availableIntegrations, setAvailableIntegrations] = useState<Integration[]>([]);
  const [enabledIntegrations, setEnabledIntegrations] = useState<string[]>(user?.enabledIntegrations || []);
  const [isLoadingIntegrations, setIsLoadingIntegrations] = useState(false);
  const [modelConfigs, setModelConfigs] = useState<ModelConfig[]>(user?.modelConfigs || []);
  const [voiceId, setVoiceId] = useState(user?.voiceSettings?.voiceId || voiceOptions[0].id);
  const [voiceName, setVoiceName] = useState(user?.voiceSettings?.voiceName || voiceOptions[0].name);
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);

  const configMenuRef = useRef<HTMLDivElement | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const [isEditingContext, setIsEditingContext] = useState(false);
  const [editableContextValue, setEditableContextValue] = useState(String(MIN_CONTEXT));
  const [isEditingMaxOutput, setIsEditingMaxOutput] = useState(false);
  const [editableMaxOutputValue, setEditableMaxOutputValue] = useState(String(4096));

  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [gptSection, setGptSection] = useState<GptSection>('general');
  const [showAdvancedProviderSettings, setShowAdvancedProviderSettings] = useState(false);
  const [isGptTreeExpanded, setIsGptTreeExpanded] = useState(true);
  const [editingCustomProviderId, setEditingCustomProviderId] = useState<string | null>(null);
  const [editableCustomProviderName, setEditableCustomProviderName] = useState('');

  const customProviderEntries = useMemo(() => (
    providerConfigs
      .map((config) => config.provider)
      .filter((providerId, index, arr) => !baseProviderIds.has(providerId) && arr.indexOf(providerId) === index)
      .sort()
  ), [providerConfigs]);

  const getProviderConfig = useCallback((providerId: string): ProviderConfig => {
    if (providerId === 'default') {
      return {
        provider: 'default',
        baseUrl: '',
        enabled: true,
        contextLength: MIN_CONTEXT,
        maxOutputTokens: 4096,
      };
    }

    const fromState = providerConfigs.find((config) => config.provider === providerId);
    if (fromState) {
      return {
        provider: providerId,
        baseUrl: fromState.baseUrl || '',
        enabled: fromState.enabled !== false,
        contextLength: fromState.contextLength || MIN_CONTEXT,
        maxOutputTokens: fromState.maxOutputTokens || 4096,
      };
    }

    return {
      provider: providerId,
      baseUrl: providerId === 'openai' ? baseUrl : '',
      enabled: true,
      contextLength: MIN_CONTEXT,
      maxOutputTokens: 4096,
    };
  }, [baseUrl, providerConfigs]);

  const setProviderConfig = useCallback((providerId: string, patch: Partial<ProviderConfig>) => {
    if (providerId === 'default') return;

    setProviderConfigs((prev) => {
      const existing = prev.find((entry) => entry.provider === providerId) || {
        provider: providerId,
        baseUrl: providerId === 'openai' ? baseUrl : '',
        enabled: true,
        contextLength: MIN_CONTEXT,
        maxOutputTokens: 4096,
      };

      const next = {
        ...existing,
        ...patch,
        provider: providerId,
      };

      const withoutCurrent = prev.filter((entry) => entry.provider !== providerId);
      return [...withoutCurrent, next];
    });
  }, [baseUrl]);

  useEffect(() => {
    const currentConfig = getProviderConfig(selectedProvider);
    if (selectedProvider === 'openai') {
      setBaseUrl(currentConfig.baseUrl || '');
    } else {
      setBaseUrl('');
    }
    setEditableContextValue(String(currentConfig.contextLength || MIN_CONTEXT));
    setEditableMaxOutputValue(String(currentConfig.maxOutputTokens || 4096));
  }, [getProviderConfig, selectedProvider]);

  useEffect(() => {
    if (!isEditingContext) {
      setEditableContextValue(String(MIN_CONTEXT));
    }
  }, [isEditingContext]);

  useEffect(() => {
    if (!isEditingMaxOutput) {
      setEditableMaxOutputValue(String(4096));
    }
  }, [isEditingMaxOutput]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
      }
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (isOpen && user) {
      const nextProviderConfigs = Array.isArray(user.providerConfigs)
        ? user.providerConfigs.map((config) => ({
            provider: config.provider,
            baseUrl: config.baseUrl || '',
            enabled: config.enabled !== false,
            contextLength: config.contextLength || MIN_CONTEXT,
            maxOutputTokens: config.maxOutputTokens || 4096,
          }))
        : [];

      if (user.baseUrl && !nextProviderConfigs.some((config) => config.provider === 'openai')) {
        nextProviderConfigs.push({
          provider: 'openai',
          baseUrl: user.baseUrl,
          enabled: true,
          contextLength: user.contextLength || MIN_CONTEXT,
          maxOutputTokens: user.maxOutputTokens || 4096,
        });
      }

      setSelectedProvider(user.selectedProvider || 'default');
      setApiKeys(user.apiKeys || []);
      setBaseUrl(user.baseUrl || '');
      setProviderConfigs(nextProviderConfigs);
      setSelectedModel(user.selectedModel || '');
      setProviderModels({});

      setQuickAccessModels(user.quickAccessModels || []);
      setModelConfigs(user.modelConfigs || []);
      setEditableContextValue(String(user.contextLength || MIN_CONTEXT));
      setEditableMaxOutputValue(String(user.maxOutputTokens || 4096));
      setEnabledIntegrations(user.enabledIntegrations || []);
      const providerVoiceId = user.voiceSettings?.voiceId || voiceOptions[0].id;
      const selectedVoice = voiceOptions.find((voice) => voice.id === providerVoiceId);
      setVoiceId(providerVoiceId);
      setVoiceName(user.voiceSettings?.voiceName || selectedVoice?.name || '');
      setGptSection('general');
      setShowAdvancedProviderSettings(false);
      setIsGptTreeExpanded(true);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setIsApiKeyVisible(false);
      setOpenConfigMenuId(null);
      setIsEditingContext(false);
      setIsEditingMaxOutput(false);
      setModelSearchQuery(''); // Reset search on close
      setShowSelectedOnly(false);
      setGptSection('general');
      setShowAdvancedProviderSettings(false);
      setIsGptTreeExpanded(true);
      setProviderModels({});
      setPreviewingVoiceId(null);
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }
    }
  }, [isOpen]);

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      if (configMenuRef.current && !configMenuRef.current.contains(event.target as Node)) {
        setOpenConfigMenuId(null);
      }
    };

    if (openConfigMenuId) {
      document.addEventListener('mousedown', handleDocumentClick);
    }

    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
    };
  }, [openConfigMenuId]);

  useEffect(() => {
    const fetchIntegrations = async () => {
      if (!isOpen || activeTab !== 'Integrations') return;
      setIsLoadingIntegrations(true);
      try {
        const res = await api('/integrations');
        if (!res.ok) throw new Error('Failed to load integrations');
        const data = await res.json();
        setAvailableIntegrations(Array.isArray(data) ? data : []);
      } catch {
        setAvailableIntegrations([]);
      } finally {
        setIsLoadingIntegrations(false);
      }
    };

    fetchIntegrations();
  }, [activeTab, isOpen]);

  const handleClose = () => {
    if (isClosing) return;
    setIsClosing(true);
    closeTimeoutRef.current = window.setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 180);
  };

  const fetchProviderModels = async (providerId: string) => {
    setIsFetching(true);
    setFetchError('');
    try {
      const res = await api('/models', {
        method: 'POST',
        body: JSON.stringify({
          provider: providerId,
          apiKeys,
          providerConfigs,
          baseUrl: getProviderConfig('openai').baseUrl || '',
        }),
      });
      const payload = await res.json().catch(() => []);
      if (!res.ok) {
        throw new Error(payload?.error || payload?.msg || `Failed to fetch ${providerId} models.`);
      }

      const seen = new Set<string>();
      const uniqueModels = (Array.isArray(payload) ? payload : []).filter((model: Model) => {
        if (!model?.id || seen.has(model.id)) return false;
        seen.add(model.id);
        return true;
      });
      setProviderModels((prev) => ({ ...prev, [providerId]: uniqueModels }));
      return uniqueModels;
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : 'Failed to fetch models.');
      return [];
    } finally {
      setIsFetching(false);
    }
  };

  useEffect(() => {
    if (!isOpen || activeTab !== 'GPT' || gptSection !== 'general') return;

    const enabledProviderIds = [
      ...providers.map((provider) => provider.id),
      ...customProviderEntries,
    ].filter((providerId) => providerId !== 'default' && getProviderConfig(providerId).enabled !== false);

    const pendingProviderIds = enabledProviderIds.filter((providerId) => {
      const hasKey = !!apiKeys.find((entry) => entry.provider === providerId)?.key;
      return hasKey && !providerModels[providerId];
    });

    if (pendingProviderIds.length === 0) return;

    let cancelled = false;
    const load = async () => {
      for (const providerId of pendingProviderIds) {
        if (cancelled) break;
        await fetchProviderModels(providerId);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [activeTab, apiKeys, customProviderEntries, getProviderConfig, gptSection, isOpen, providerModels]);

  const handleApiKeyChange = (providerId: string, value: string) => {
    setApiKeys((prev) => {
      const next = [...prev];
      const existingIndex = next.findIndex((entry) => entry.provider === providerId);
      if (existingIndex >= 0) {
        next[existingIndex] = { provider: providerId, key: value };
      } else {
        next.push({ provider: providerId, key: value });
      }
      return next;
    });
    setFetchError('');
  };

  const handleQuickAccessChange = (entry: ProviderModelEntry) => {
    setQuickAccessModels((prev) => {
      const modelConfig = modelConfigs.find((config) => config.id === entry.id);
      const isEnabled = prev.includes(entry.id) && (modelConfig?.provider || entry.provider) === entry.provider;
      const next = isEnabled
        ? prev.filter((id) => id !== entry.id)
        : [...prev.filter((id) => id !== entry.id), entry.id];
      if (isEnabled && selectedModel === entry.id) {
        setSelectedModel('');
      }
      return Array.from(new Set(next));
    });

    setModelConfigs((prev) => {
      const existing = prev.find((config) => config.id === entry.id);
      if (existing && existing.provider === entry.provider) {
        return prev;
      }

      const withoutCurrent = prev.filter((config) => config.id !== entry.id);
      return [...withoutCurrent, {
        id: entry.id,
        provider: entry.provider,
        modalities: existing?.modalities && existing.modalities.length > 0 ? existing.modalities : ['text'],
      }];
    });
  };

  const handleModalityChange = (modelId: string, providerId: string, modality: Modality, enabled: boolean) => {
    setModelConfigs((prev) => {
      const existing = prev.find((config) => config.id === modelId && (config.provider || providerId) === providerId)
        || { id: modelId, provider: providerId, modalities: ['text'] as Modality[] };
      const currentModalities: Modality[] = Array.isArray(existing.modalities)
        ? (existing.modalities as Modality[])
        : ['text'];
      const baseModalities: Modality[] = currentModalities.includes('text')
        ? currentModalities
        : ['text', ...currentModalities];
      const nextModalities: Modality[] = enabled
        ? Array.from(new Set([...baseModalities, modality]))
        : baseModalities.filter((entry) => entry !== modality);
      const nextConfig = { id: modelId, modalities: nextModalities };
      const modelProvider = existing.provider || providerId || selectedProvider;
      const nextConfigWithProvider = { ...nextConfig, provider: modelProvider };

      const withoutCurrent = prev.filter((config) => !(config.id === modelId && (config.provider || providerId) === providerId));
      return [...withoutCurrent, nextConfigWithProvider];
    });
  };

  const handleProviderEnabledChange = (providerId: string, enabled: boolean) => {
    setProviderConfig(providerId, { enabled });

    if (!enabled) {
      setQuickAccessModels((prev) => prev.filter((modelId) => {
        const config = modelConfigs.find((entry) => entry.id === modelId);
        return (config?.provider || '') !== providerId;
      }));
      setModelConfigs((prev) => prev.filter((entry) => (entry.provider || '') !== providerId));
      if (selectedModel && modelConfigs.find((entry) => entry.id === selectedModel)?.provider === providerId) {
        setSelectedModel('');
      }
    }
  };

  const handleMenuToggle = (modelId: string, event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (openConfigMenuId === modelId) {
      setOpenConfigMenuId(null);
      return;
    }

    const buttonRect = event.currentTarget.getBoundingClientRect();
    setMenuPosition({
      top: buttonRect.bottom + window.scrollY + 6,
      left: buttonRect.left + window.scrollX - 80,
    });
    setOpenConfigMenuId(modelId);
  };

  const handleContextInputBlur = (providerId: string) => {
    const parsed = parseInt(editableContextValue, 10);
    const fallback = getProviderConfig(providerId).contextLength;
    const sanitized = Number.isFinite(parsed)
      ? Math.max(MIN_CONTEXT, Math.min(MAX_CONTEXT, parsed))
      : fallback;
    setProviderConfig(providerId, { contextLength: sanitized });
    setEditableContextValue(String(sanitized));
    setIsEditingContext(false);
  };

  const handleContextInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, providerId: string) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleContextInputBlur(providerId);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setEditableContextValue(String(getProviderConfig(providerId).contextLength));
      setIsEditingContext(false);
    }
  };

  const handleMaxOutputInputBlur = (providerId: string) => {
    const parsed = parseInt(editableMaxOutputValue, 10);
    const fallback = getProviderConfig(providerId).maxOutputTokens;
    const sanitized = Number.isFinite(parsed)
      ? Math.max(MIN_OUTPUT_TOKENS, Math.min(MAX_OUTPUT_TOKENS, parsed))
      : fallback;
    setProviderConfig(providerId, { maxOutputTokens: sanitized });
    setEditableMaxOutputValue(String(sanitized));
    setIsEditingMaxOutput(false);
  };

  const handleMaxOutputInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, providerId: string) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleMaxOutputInputBlur(providerId);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setEditableMaxOutputValue(String(getProviderConfig(providerId).maxOutputTokens));
      setIsEditingMaxOutput(false);
    }
  };

  const handleIntegrationToggle = (integrationId: string, enabled: boolean) => {
    if (user?.subscriptionStatus !== 'active') {
      showNotification('Integrations are available on the Pro plan.', 'error');
      return;
    }

    setEnabledIntegrations((prev) => (
      enabled
        ? Array.from(new Set([...prev, integrationId]))
        : prev.filter((id) => id !== integrationId)
    ));
  };

  const handleVoicePreview = async (voice: VoiceOption) => {
    if (previewingVoiceId === voice.id) {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current.currentTime = 0;
      }
      setPreviewingVoiceId(null);
      return;
    }

    try {
      setPreviewingVoiceId(voice.id);
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
      }

      const res = await api('/voice/tts', {
        method: 'POST',
        body: JSON.stringify({ text: voice.previewText, voiceId: voice.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Voice preview failed.');
      }

      const audioBlob = await res.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      previewAudioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        setPreviewingVoiceId(null);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        setPreviewingVoiceId(null);
      };
      await audio.play();
    } catch (error) {
      setPreviewingVoiceId(null);
      showNotification(error instanceof Error ? error.message : 'Voice preview failed.', 'error');
    }
  };

  const handleAddProvider = () => {
    const baseName = 'custom-openai';
    const existingCustomIds = new Set(providerConfigs.map((config) => config.provider));
    let index = 1;
    let nextId = `${baseName}-${index}`;

    while (existingCustomIds.has(nextId) || baseProviderIds.has(nextId)) {
      index += 1;
      nextId = `${baseName}-${index}`;
    }

    setProviderConfigs((prev) => ([
      ...prev,
      {
        provider: nextId,
        baseUrl: '',
        enabled: true,
        contextLength: 128000,
        maxOutputTokens: 4096,
      },
    ]));

    setApiKeys((prev) => {
      if (prev.some((entry) => entry.provider === nextId)) return prev;
      return [...prev, { provider: nextId, key: '' }];
    });

    setSelectedProvider(nextId);
    setGptSection(`provider:${nextId}`);
    setShowAdvancedProviderSettings(true);
  };

  const handleDeleteCustomProvider = (providerId: string) => {
    if (baseProviderIds.has(providerId)) return;

    setProviderConfigs((prev) => prev.filter((config) => config.provider !== providerId));
    setProviderModels((prev) => {
      const { [providerId]: _ignored, ...rest } = prev;
      return rest;
    });
    setApiKeys((prev) => prev.filter((entry) => entry.provider !== providerId));
    setQuickAccessModels((prev) => prev.filter((modelId) => {
      const config = modelConfigs.find((entry) => entry.id === modelId);
      return (config?.provider || '') !== providerId;
    }));
    setModelConfigs((prev) => prev.filter((entry) => (entry.provider || '') !== providerId));
    setSelectedProvider((prev) => (prev === providerId ? 'default' : prev));
    setGptSection((prev) => (prev === `provider:${providerId}` ? 'general' : prev));
    setShowAdvancedProviderSettings(false);
    setEditingCustomProviderId((prev) => (prev === providerId ? null : prev));
    setEditableCustomProviderName('');
  };

  const handleStartRenameCustomProvider = (providerId: string) => {
    setEditingCustomProviderId(providerId);
    setEditableCustomProviderName(providerId);
  };

  const handleCancelRenameCustomProvider = () => {
    setEditingCustomProviderId(null);
    setEditableCustomProviderName('');
  };

  const handleCommitRenameCustomProvider = (providerId: string) => {
    const nextProviderId = editableCustomProviderName.trim();

    if (!nextProviderId || nextProviderId === providerId) {
      handleCancelRenameCustomProvider();
      return;
    }

    if (baseProviderIds.has(nextProviderId) || customProviderEntries.includes(nextProviderId)) {
      showNotification('Provider name already exists. Choose another one.', 'error');
      return;
    }

    setProviderConfigs((prev) => prev.map((config) => (
      config.provider === providerId
        ? { ...config, provider: nextProviderId }
        : config
    )));
    setApiKeys((prev) => prev.map((entry) => (
      entry.provider === providerId
        ? { ...entry, provider: nextProviderId }
        : entry
    )));
    setSelectedProvider((prev) => (prev === providerId ? nextProviderId : prev));
    setGptSection((prev) => (prev === `provider:${providerId}` ? `provider:${nextProviderId}` : prev));
    setEditingCustomProviderId(null);
    setEditableCustomProviderName('');
  };

  const handleManualFetch = async () => {
    const currentApiKey = apiKeys.find(k => k.provider === selectedProvider)?.key;

    if (!currentApiKey) {
      const providerName = providers.find(p => p.id === selectedProvider)?.name || 'Current provider';
      setFetchError(`${providerName} API Key is required to fetch models.`);
      return;
    }
    await updateSettings({
      selectedProvider,
      apiKeys,
      baseUrl: selectedProvider === 'openai' ? getProviderConfig('openai').baseUrl : '',
      providerConfigs,
    });
    await fetchProviderModels(selectedProvider);
  };

  const handleSave = async () => {
    try {
      const activeModelIds = Array.from(new Set(quickAccessModels.filter((modelId) => {
        const config = modelConfigs.find((entry) => entry.id === modelId);
        const modelProvider = config?.provider || selectedProvider;
        return modelProvider !== 'default' && getProviderConfig(modelProvider).enabled !== false;
      })));
      const nextSelectedModel = activeModelIds.includes(selectedModel) ? selectedModel : (activeModelIds[0] || '');

      if (!nextSelectedModel) {
        showNotification('Select at least one Active Model to continue.', 'error');
        return;
      }

      const configsToSave = modelConfigs.filter((config) => activeModelIds.includes(config.id));
      setSelectedModel(nextSelectedModel);

      const settingsToSave = {
        selectedProvider,
        apiKeys,
        baseUrl: getProviderConfig('openai').baseUrl || '',
        providerConfigs,
        modelConfigs: configsToSave,
        contextLength: getProviderConfig(selectedProvider).contextLength,
        maxOutputTokens: getProviderConfig(selectedProvider).maxOutputTokens,
        selectedModel: nextSelectedModel,
        quickAccessModels: activeModelIds,
        enabledIntegrations,
        voiceSettings: { voiceId, voiceName },
      };
      
      await updateSettings(settingsToSave);

      showNotification('Settings Saved!');
      handleClose();
    } catch (err) {
      showNotification(`Failed to save settings.\n${err}`, "error");
    }
  };

  const renderGptTab = () => {
    const isGeneralSection = gptSection === 'general';
    const sectionProviderId = isGeneralSection ? selectedProvider : gptSection.replace('provider:', '');
    const isDefaultProviderSelected = sectionProviderId === 'default';
    const currentProviderConfig = getProviderConfig(sectionProviderId);
    const currentApiKey = apiKeys.find((entry) => entry.provider === sectionProviderId)?.key || '';
    const allProviderOptions: Provider[] = [
      ...providers,
      ...customProviderEntries.map((providerId) => ({
        id: providerId,
        name: providerId,
      })),
    ];
    const enabledProviderIds = allProviderOptions
      .map((provider) => provider.id)
      .filter((providerId) => providerId !== 'default' && getProviderConfig(providerId).enabled !== false);
    const availableModelEntries: ProviderModelEntry[] = enabledProviderIds.flatMap((providerId) => (
      (providerModels[providerId] || []).map((model) => ({ id: model.id, provider: providerId }))
    ));
    const seenEntries = new Set<string>();
    const dedupedModelEntries = availableModelEntries.filter((entry) => {
      const key = `${entry.provider}:${entry.id}`;
      if (seenEntries.has(key)) return false;
      seenEntries.add(key);
      return true;
    });
    const isModelChecked = (entry: ProviderModelEntry) => {
      const config = modelConfigs.find((modelConfig) => modelConfig.id === entry.id);
      return quickAccessModels.includes(entry.id) && (config?.provider || entry.provider) === entry.provider;
    };
    const searchFilteredModels = dedupedModelEntries.filter((entry) => (
      entry.id.toLowerCase().includes(modelSearchQuery.toLowerCase())
    ));
    const filteredModels = showSelectedOnly
      ? searchFilteredModels.filter((entry) => isModelChecked(entry))
      : searchFilteredModels;
    const getApiKeyPlaceholder = () => {
        switch (sectionProviderId) {
            case 'openai': return 'Required: sk-...';
            case 'anthropic': return 'Required: sk-ant-...';
            case 'gemini': return 'Required: Your Gemini API Key';
            default: return 'API Key';
        }
    };

    return (
    <>
      <h3>GPT Settings</h3>
      <p>Configure your connection to a compatible LLM provider.</p>
      <div className="gpt-section-content">
          {isGeneralSection && isDefaultProviderSelected ? (
            <div className="form-group default-provider-info">
              <p className="description">
                You are using free Gemini 2.5 Flash model.
              </p>
              <p>
                Rate limits spread across all users.
              </p>
            </div>
          ) : null}

          {!isGeneralSection && !isDefaultProviderSelected && (
            <>
              <div className="form-group">
                <label htmlFor="apiKey">API Key</label>
                <div className="input-wrapper">
                  <input 
                    id="apiKey" 
                    type={isApiKeyVisible ? 'text' : 'password'}
                    className={!isApiKeyVisible ? 'input-hidden' : ''}
                    value={apiKeys.find(k => k.provider === sectionProviderId)?.key || ''}
                    onChange={(e) => handleApiKeyChange(sectionProviderId, e.target.value)} 
                    placeholder={ getApiKeyPlaceholder() }
                    autoComplete="off"
                  />
                  <Tooltip text={isApiKeyVisible ? "Hide API Key" : "Show API Key"}>
                    <button type="button" className="visibility-toggle-btn" onClick={() => setIsApiKeyVisible(prev => !prev)}>
                      {isApiKeyVisible ? <FiEyeOff size={18} /> : <FiEye size={18} />}
                    </button>
                  </Tooltip>
                </div>
              </div>

              <div className="form-group">
                <div className="label-with-value">
                  <label htmlFor="providerEnabled">Enabled</label>
                </div>
                <p className="description">Include this provider in the Active Models list.</p>
                <label className="switch" aria-label={`Enable ${sectionProviderId}`}>
                  <input
                    id="providerEnabled"
                    type="checkbox"
                    checked={currentProviderConfig.enabled !== false}
                    onChange={(event) => handleProviderEnabledChange(sectionProviderId, event.target.checked)}
                  />
                  <span className="slider" />
                </label>
              </div>

              <button
                type="button"
                className="provider-advanced-toggle"
                onClick={() => setShowAdvancedProviderSettings((prev) => !prev)}
              >
                {showAdvancedProviderSettings ? 'Hide provider details' : 'Edit provider details'}
              </button>

              {showAdvancedProviderSettings && (
                <>
                  {(sectionProviderId === 'openai' || customProviderEntries.includes(sectionProviderId)) && (
                    <div className="form-group">
                      <label htmlFor="baseUrl">Base URL (optional)</label>
                      <input 
                          id="baseUrl" 
                          type="text" 
                          value={currentProviderConfig.baseUrl} 
                          onChange={(e) => setProviderConfig(sectionProviderId, { baseUrl: e.target.value })} 
                          placeholder="e.g., https://api.groq.com/openai/v1"
                      />
                    </div>
                  )}
                  
                  <div className="form-group">
                    <div className="label-with-value">
                      <label htmlFor="contextLength">Total Context Length</label>
                      {isEditingContext ? (
                        <input
                          type="number"
                          value={editableContextValue}
                          onChange={(e) => setEditableContextValue(e.target.value)}
                          onBlur={() => handleContextInputBlur(sectionProviderId)}
                          onKeyDown={(e) => handleContextInputKeyDown(e, sectionProviderId)}
                          className="context-value-input"
                          autoFocus
                          onFocus={(e) => e.target.select()}
                        />
                      ) : (
                        <span
                          onClick={() => setIsEditingContext(true)}
                          className="context-value-span"
                        >
                          {currentProviderConfig.contextLength}
                        </span>
                      )}
                    </div>
                    <p className="description">
                      The total token window for the model (input + output). Set this to your selected model's maximum context.
                    </p>
                    <div className="context-slider-group">
                        <input 
                            type="range" 
                            id="contextLength"
                            min={MIN_CONTEXT}
                            max={MAX_CONTEXT}
                            step="1024"
                            value={currentProviderConfig.contextLength}
                            onChange={(e) => setProviderConfig(sectionProviderId, { contextLength: parseInt(e.target.value, 10) })}
                            className="context-slider"
                        />
                    </div>
                  </div>

                  <div className="form-group">
                    <div className="label-with-value">
                      <label htmlFor="maxOutputTokens">Max Output Tokens</label>
                      {isEditingMaxOutput ? (
                        <input
                          type="number"
                          value={editableMaxOutputValue}
                          onChange={(e) => setEditableMaxOutputValue(e.target.value)}
                          onBlur={() => handleMaxOutputInputBlur(sectionProviderId)}
                          onKeyDown={(e) => handleMaxOutputInputKeyDown(e, sectionProviderId)}
                          className="context-value-input"
                          autoFocus
                          onFocus={(e) => e.target.select()}
                        />
                      ) : (
                        <span
                          onClick={() => setIsEditingMaxOutput(true)}
                          className="context-value-span"
                        >
                          {currentProviderConfig.maxOutputTokens}
                        </span>
                      )}
                    </div>
                    <p className="description">
                      Controls the maximum tokens the model can generate in one response. This is reserved from the total context length.
                    </p>
                    <div className="context-slider-group">
                        <input 
                            type="range" 
                            id="maxOutputTokens"
                            min={MIN_OUTPUT_TOKENS}
                            max={MAX_OUTPUT_TOKENS}
                            step="256"
                            value={currentProviderConfig.maxOutputTokens}
                            onChange={(e) => setProviderConfig(sectionProviderId, { maxOutputTokens: parseInt(e.target.value, 10) })}
                            className="context-slider"
                        />
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {isGeneralSection && (
            <>
              {filteredModels.length > 0 && (
                <>
                <div className="form-group">
                  <label>Active Models</label>
                  <p className="description">Models from enabled providers that appear in your chat model list.</p>
                  
                  <div className="model-search-wrapper">
                    <input
                      type="text"
                      className="model-search-input"
                      placeholder="Search available models..."
                      value={modelSearchQuery}
                      onChange={(e) => setModelSearchQuery(e.target.value)}
                    />
                    <button 
                        className={`model-search-clear-btn ${modelSearchQuery ? 'visible' : ''}`}
                        onClick={() => setModelSearchQuery('')}
                      >
                        <FiX size={18} />
                    </button>
                  </div>
                  <button
                    type="button"
                    className={`model-filter-toggle ${showSelectedOnly ? 'active' : ''}`}
                    onClick={() => setShowSelectedOnly((prev) => !prev)}
                  >
                    Show Selected
                  </button>
                  <div className="quick-access-list">
                    {filteredModels.map((modelEntry) => {
                        const config = modelConfigs.find((c) => c.id === modelEntry.id && (c.provider || modelEntry.provider) === modelEntry.provider) || { modalities: ['text'] };
                        const hasImageModality = config.modalities.some(modality => modality === 'image');
                        const modelKey = `${modelEntry.provider}:${modelEntry.id}`;
                        const checked = isModelChecked(modelEntry);
                        const providerInfo = allProviderOptions.find((provider) => provider.id === modelEntry.provider);
                        const ProviderIcon = providerInfo?.Icon;

                        return (
                        <div
                          key={modelKey}
                          className={`quick-access-row ${checked ? 'selected' : ''}`}
                          onClick={() => handleQuickAccessChange(modelEntry)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              handleQuickAccessChange(modelEntry);
                            }
                          }}
                        >
                          <div className="quick-access-item quick-access-item-static">
                            {ProviderIcon ? (
                              <ProviderIcon className="provider-model-icon" />
                            ) : (
                              <div className="provider-model-icon provider-icon-fallback">{modelEntry.provider.charAt(0).toUpperCase()}</div>
                            )}
                            <span className="model-name-text">{modelEntry.id}</span>
                          </div>
                          <div
                            className="model-config-wrapper"
                            onClick={(event) => event.stopPropagation()}
                            onMouseDown={(event) => event.stopPropagation()}
                          >
                            <button className="model-config-button" onClick={(e) => handleMenuToggle(modelKey, e)} disabled={!checked}>
                              <FiMoreVertical size={16}/>
                            </button>
                            {openConfigMenuId === modelKey && (
                              <Portal>
                                <div
                                  className="model-config-menu"
                                  ref={configMenuRef}
                                  style={{ position: 'absolute', top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }}
                                  onClick={(event) => event.stopPropagation()}
                                  onMouseDown={(event) => event.stopPropagation()}
                                >
                                  <label className="config-menu-item">
                                      <input type="checkbox" checked disabled />
                                      <span>Text</span>
                                      <span className="modality-dot active"></span>
                                  </label>
                                  <label className="config-menu-item">
                                      <input type="checkbox" checked={hasImageModality} onChange={(e) => handleModalityChange(modelEntry.id, modelEntry.provider, 'image', e.target.checked)} />
                                      <span>Image</span>
                                      <span className={`modality-dot ${hasImageModality ? 'active' : ''}`}></span>
                                  </label>
                                </div>
                              </Portal>
                            )}
                          </div>
                        </div>
                        );
                      })}
                  </div>
                  {filteredModels.length === 0 && (
                    <div className="no-models-found">No models found matching your search.</div>
                  )}
                </div>
                </>
              )}

              {filteredModels.length === 0 && (
                 <div className="form-group">
                    <label htmlFor="model">Active Models</label>
                    <div className="model-select-wrapper">
                        <div className="placeholder-selector">
                            {isFetching ? 'Loading models...' : 'Select a provider and click Refresh to load models'}
                        </div>
                        <Tooltip text={!currentApiKey ? "API Key is required" : "Save credentials & Refresh models" }>
                            <button 
                            className="refresh-button" 
                            onClick={handleManualFetch} 
                            disabled={isFetching || !currentApiKey}
                            >
                            {isFetching ? '...' : <FiRefreshCw size={16} />}
                            </button>
                        </Tooltip>
                    </div>
                    {fetchError && <p className="error-text">{fetchError}</p>}
                </div>
              )}
            </>
          )}
      </div>
      
      <div className="modal-actions">
        <button className="modal-button modal-button-cancel" onClick={handleClose}>Cancel</button>
        <button className="modal-button modal-button-save" onClick={handleSave}>Save & Close</button>
      </div>
    </>
    );
  };

  const handleManageSubscription = async () => {
    try {
      const res = await api('/stripe/create-portal-session', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.msg || 'Unable to open subscription portal.');
      }
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error('No portal URL returned.');
    } catch (error) {
      showNotification(error instanceof Error ? error.message : 'An error occurred.', 'error');
    }
  };

  const renderIntegrationsTab = () => {
    const canUseIntegrations = user?.subscriptionStatus === 'active';

    return (
      <>
        <h3>Integrations</h3>
        <p>Connect tools the assistant can use while chatting.</p>

        {!canUseIntegrations && (
          <div className="upgrade-prompt">
            <FiStar size={16} />
            <span>Integrations are available on Pro.</span>
            <button type="button" onClick={handleUpgrade}>Upgrade</button>
          </div>
        )}

        {isLoadingIntegrations ? (
          <p className="description">Loading integrations...</p>
        ) : (
          <div className="integrations-list">
            {availableIntegrations.map((integration) => {
              const enabled = enabledIntegrations.includes(integration.id);
              return (
                <div key={integration.id} className="integration-card">
                  <div className="integration-info">
                    <h4>{integration.name}</h4>
                    <p>{integration.description}</p>
                  </div>

                  <label className="switch" aria-label={`Enable ${integration.name}`}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(event) => handleIntegrationToggle(integration.id, event.target.checked)}
                      disabled={!canUseIntegrations}
                    />
                    <span className="slider" />
                  </label>
                </div>
              );
            })}
          </div>
        )}
      </>
    );
  };

  const renderVoiceTab = () => {
    const canUseVoice = user?.subscriptionStatus === 'active';

    return (
      <>
        <h3>Voice</h3>
        <p>Choose the voice used for text-to-speech playback.</p>

        {!canUseVoice && (
          <div className="upgrade-prompt">
            <FiStar size={16} />
            <span>Voice features are available on Pro.</span>
            <button type="button" onClick={handleUpgrade}>Upgrade</button>
          </div>
        )}

        <div className="voice-grid">
          {voiceOptions.map((voice) => {
            const selected = voiceId === voice.id;
            const previewing = previewingVoiceId === voice.id;

            return (
              <div key={voice.id} className={`voice-card ${selected ? 'selected' : ''}`}>
                <div className="voice-card-header">
                  <span className={`voice-gender ${voice.gender}`} />
                  <h4>{voice.name}</h4>
                </div>
                <p className="voice-desc">{voice.description}</p>

                <div className="voice-actions">
                  <button
                    type="button"
                    className="preview-btn"
                    onClick={() => handleVoicePreview(voice)}
                    disabled={!canUseVoice}
                  >
                    {previewing ? <FiPause size={12} /> : <FiPlay size={12} />}
                    {previewing ? 'Stop' : 'Preview'}
                  </button>

                  <label className="select-radio">
                    <input
                      type="radio"
                      name="voice-option"
                      checked={selected}
                      onChange={() => {
                        setVoiceId(voice.id);
                        setVoiceName(voice.name);
                      }}
                      disabled={!canUseVoice}
                    />
                    Select
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  };

  // --- START: New Subscription Handler ---
  const handleUpgrade = () => {
    navigate('/app/pricing');
    handleClose(); // Close the modal after navigating
  };
  // --- END: New Subscription Handler ---

  // --- START: Updated Subscription Tab ---
  const renderSubscriptionTab = () => {
    const status = user?.subscriptionStatus;
    const isPro = status === 'active';
    const isCanceled = status === 'canceled';
    const isPaymentIssue = ['past_due', 'unpaid', 'incomplete'].includes(status || '');

    let planName = 'Free Plan';
    let planFeatures = freeFeatures;
    let statusText = 'Active';
    let statusClass = 'free';
    let description = 'You are currently on the Free plan, with access to basic features.';
    let ctaButton: React.ReactNode = (
      <button className="modal-button sub-button upgrade" onClick={handleUpgrade}>
        Upgrade to Pro
      </button>
    );

    if (isPro) {
      planName = 'Pro Plan';
      planFeatures = proFeatures;
      statusText = 'Active';
      statusClass = 'active';
      description = 'Your subscription is active. All Pro features are available to you.';
      ctaButton = (
        <button className="modal-button sub-button manage" onClick={handleManageSubscription} disabled={!user?.stripeCustomerId}>
          Manage Subscription
        </button>
      );
    } else if (isCanceled) {
      planName = 'Pro Plan';
      planFeatures = proFeatures;
      statusText = 'Canceled';
      statusClass = 'canceled';
      description = 'Your plan is canceled and will not renew. You can use Pro features until the end of the current billing period.';
      ctaButton = (
        <button className="modal-button sub-button upgrade" onClick={handleUpgrade}>
          Resubscribe to Pro
        </button>
      );
    } else if (isPaymentIssue) {
      planName = 'Pro Plan';
      planFeatures = proFeatures;
      statusText = 'Payment Due';
      statusClass = 'warning';
      description = 'Your payment failed. Please update your payment method to restore access to Pro features.';
      ctaButton = (
        <button className="modal-button sub-button warning" onClick={handleManageSubscription} disabled={!user?.stripeCustomerId}>
          Update Payment Info
        </button>
      );
    }

    return (
      <>
        <h3>Subscription</h3>
        <p>Manage your billing and subscription plan.</p>
        <div className={`subscription-info-card ${statusClass}`}>
          <div className="plan-header">
            <h4>{planName}</h4>
            <span className={`status-badge ${statusClass}`}>{statusText}</span>
          </div>
          <p className="plan-description">{description}</p>
          <ul className="plan-features-list">
            {planFeatures.map((feature, index) => (
              <li key={index}>
                <FiCheckCircle size={16} />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          <div className="plan-actions">
            {ctaButton}
          </div>
        </div>
      </>
    );
  };
  // --- END: Updated Subscription Tab ---

  const renderAppearanceTab = () => (
    <>
      <h3>Appearance</h3>
      <p>Customize the look and feel of the application.</p>
      <div className="form-group">
        <label>Theme</label>
        <div className="theme-options">
          <div className={`theme-card ${theme === 'light' ? 'selected' : ''}`} onClick={() => setTheme('light')} data-theme-name="light">
            <div className="theme-preview">Aa</div>
            <span>Light</span>
          </div>
          <div className={`theme-card ${theme === 'dark' ? 'selected' : ''}`} onClick={() => setTheme('dark')} data-theme-name="dark">
            <div className="theme-preview">Aa</div>
            <span>Dark</span>
          </div>
        </div>
      </div>
    </>
  );

  if (!isOpen && !isClosing) {
    return null;
  }

  return (
    <div className={`modal-overlay ${isClosing ? 'closing' : ''}`} onClick={handleClose}>
      <div className={`modal-content ${isClosing ? 'closing' : ''}`} onClick={(e) => e.stopPropagation()}>
        <aside className="settings-sidebar">
          <h2>Settings</h2>
          <div className="gpt-sidebar-block">
            <div className="settings-tab-button-row">
              <button className={`settings-tab-button ${activeTab === 'GPT' ? 'active' : ''}`} onClick={() => setActiveTab('GPT')}>
                <FiCpu size={18} />
                <span>GPT</span>
              </button>
              <button
                type="button"
                className={`gpt-tree-toggle ${activeTab === 'GPT' ? 'active' : ''} ${isGptTreeExpanded ? 'expanded' : ''}`}
                aria-label={isGptTreeExpanded ? 'Collapse GPT sections' : 'Expand GPT sections'}
                onClick={() => {
                  if (activeTab !== 'GPT') {
                    setActiveTab('GPT');
                    setIsGptTreeExpanded(true);
                    return;
                  }
                  setIsGptTreeExpanded((prev) => !prev);
                }}
              >
                {isGptTreeExpanded ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
              </button>
            </div>

            {activeTab === 'GPT' && (
              <div className={`gpt-sidebar-tree ${isGptTreeExpanded ? 'expanded' : 'collapsed'}`} aria-label="GPT sections">
                <button
                  type="button"
                  className={`gpt-sidebar-item ${gptSection === 'general' ? 'active' : ''}`}
                  onClick={() => {
                    setGptSection('general');
                    setShowAdvancedProviderSettings(false);
                  }}
                >
                  General
                </button>

                <div className="gpt-sidebar-group-label">Base providers</div>
                {providers.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    className={`gpt-sidebar-item ${gptSection === `provider:${provider.id}` ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedProvider(provider.id);
                      setGptSection(`provider:${provider.id}`);
                      setShowAdvancedProviderSettings(false);
                    }}
                  >
                    {provider.name}
                  </button>
                ))}

                <>
                    <div className="gpt-sidebar-group-label-row">
                      <div className="gpt-sidebar-group-label">Custom providers</div>
                      <button
                        type="button"
                        className="gpt-sidebar-group-add"
                        onClick={handleAddProvider}
                        aria-label="Add custom provider"
                      >
                        +
                      </button>
                    </div>
                  {customProviderEntries.length > 0 && (
                    customProviderEntries.map((providerId) => (
                      <div
                        key={providerId}
                        className={`gpt-sidebar-item-row ${gptSection === `provider:${providerId}` ? 'active' : ''} ${editingCustomProviderId === providerId ? 'editing' : ''}`}
                      >
                        {editingCustomProviderId === providerId ? (
                          <input
                            type="text"
                            className="gpt-sidebar-rename-input"
                            value={editableCustomProviderName}
                            onChange={(event) => setEditableCustomProviderName(event.target.value)}
                            onBlur={() => handleCommitRenameCustomProvider(providerId)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                handleCommitRenameCustomProvider(providerId);
                              }
                              if (event.key === 'Escape') {
                                event.preventDefault();
                                handleCancelRenameCustomProvider();
                              }
                            }}
                            autoFocus
                          />
                        ) : (
                          <button
                            type="button"
                            className={`gpt-sidebar-item ${gptSection === `provider:${providerId}` ? 'active' : ''}`}
                            onClick={() => {
                              setSelectedProvider(providerId);
                              setGptSection(`provider:${providerId}`);
                              setShowAdvancedProviderSettings(true);
                            }}
                          >
                            {providerId}
                          </button>
                        )}

                        <div className="gpt-sidebar-item-actions">
                          <Tooltip text={`Rename ${providerId}`}>
                            <button
                              type="button"
                              className="gpt-sidebar-action gpt-sidebar-rename"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (editingCustomProviderId === providerId) {
                                  handleCommitRenameCustomProvider(providerId);
                                  return;
                                }
                                handleStartRenameCustomProvider(providerId);
                              }}
                              aria-label={`Rename ${providerId}`}
                            >
                              <FiEdit2 size={13} />
                            </button>
                          </Tooltip>

                          <Tooltip text={`Delete ${providerId}`}>
                            <button
                              type="button"
                              className="gpt-sidebar-action gpt-sidebar-delete"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleDeleteCustomProvider(providerId);
                              }}
                              aria-label={`Delete ${providerId}`}
                            >
                              <FiTrash2 size={13} />
                            </button>
                          </Tooltip>
                        </div>
                      </div>
                    ))
                  )}
                </>
              </div>
            )}
          </div>
          <button className={`settings-tab-button ${activeTab === 'Integrations' ? 'active' : ''}`} onClick={() => setActiveTab('Integrations')}>
            <FiLink size={18} />
            <span>Integrations</span>
          </button>
          <button className={`settings-tab-button ${activeTab === 'Subscription' ? 'active' : ''}`} onClick={() => setActiveTab('Subscription')}>
            <FiCreditCard size={18} />
            <span>Subscription</span>
          </button>
          <button className={`settings-tab-button ${activeTab === 'Appearance' ? 'active' : ''}`} onClick={() => setActiveTab('Appearance')}>
            <FiSliders size={18} />
            <span>Appearance</span>
          </button>
          <button className={`settings-tab-button ${activeTab === 'Voice' ? 'active' : ''}`} onClick={() => setActiveTab('Voice')}>
            <FiVolume2 size={18} />
            <span>Voice</span>
          </button>
        </aside>
        <main className="settings-content">
          <div key={activeTab === 'GPT' ? `${activeTab}-${gptSection}` : activeTab} className="settings-panel-transition">
            {activeTab === 'GPT' && renderGptTab()}
            {activeTab === 'Integrations' && renderIntegrationsTab()}
            {activeTab === 'Subscription' && renderSubscriptionTab()}
            {activeTab === 'Appearance' && renderAppearanceTab()}
            {activeTab === 'Voice' && renderVoiceTab()}
          </div>
        </main>
      </div>
    </div>
  );
};

export default SettingsModal;
