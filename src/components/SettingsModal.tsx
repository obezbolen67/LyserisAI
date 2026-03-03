import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../contexts/SettingsContext';
import { useNotification } from '../contexts/NotificationContext';
import '../css/SettingsModal.css';
import { FiRefreshCw, FiCpu, FiSliders, FiEye, FiEyeOff, FiMoreVertical, FiX, FiCreditCard, FiCheckCircle, FiLink, FiStar, FiVolume2, FiPlay, FiPause } from "react-icons/fi";
import OpenAIIcon from '../icons/openai.svg?react';
import AnthropicIcon from '../icons/anthropic.svg?react';
import GeminiIcon from '../icons/gemini.svg?react';
import api from '../utils/api';
import Tooltip from './Tooltip';
import Portal from './Portal';
import ProviderSelector, { type Provider } from './ProviderSelector';
import CustomModelSelector from './CustomModelSelector';
import '../css/ProviderSelector.css';
import '../css/VoiceSettings.css';
import '../css/CustomModelSelector.css';

type Model = { id: string };
type Modality = 'text' | 'image' | 'code' | 'reasoning';
type ModelConfig = { id: string; modalities: Modality[]; };
type ApiKeyEntry = { provider: string; key: string; };

type Integration = {
  id: string;
  name: string;
  description: string;
};

interface SettingsModalProps { isOpen: boolean; onClose: () => void; }
type ActiveTab = 'GPT' | 'Subscription' | 'Appearance' | 'Integrations' | 'Voice';

const providers: Provider[] = [
  { id: 'default', name: "Default (Free)",Icon: GeminiIcon},
  { id: 'openai', name: 'OpenAI', Icon: OpenAIIcon },
  { id: 'anthropic', name: 'Anthropic', Icon: AnthropicIcon },
  { id: 'gemini', name: 'Gemini', Icon: GeminiIcon },
];

const MIN_CONTEXT = 4096;
const MAX_CONTEXT = 1000000;
const MIN_OUTPUT_TOKENS = 256;
const MAX_OUTPUT_TOKENS = 64000;

// --- START: Added for Subscription Tab ---
const proFeatures = [
  'Premium default model (GPT-5)',
  'Code Interpreter & File Analysis',
  'Web Search capabilities',
  'Bring your own API keys',
  'Voice chat included',
  'Priority support',
];
const freeFeatures = [
    'Standard default model',
    'Code Interpreter & File Analysis',
    'Web Search capabilities',
    'Bring your own API keys',
    'Community support'
];
// --- END: Added for Subscription Tab ---

const SettingsModal = ({ isOpen, onClose }: SettingsModalProps) => {
  const { user, models, setModels, updateSettings, theme, setTheme } = useSettings();
  const { showNotification } = useNotification();
  const navigate = useNavigate();
  
  const [activeTab, setActiveTab] = useState<ActiveTab>('GPT');
  const [selectedProvider, setSelectedProvider] = useState(user?.selectedProvider || 'default');
  const [apiKeys, setApiKeys] = useState<ApiKeyEntry[]>(user?.apiKeys || []);
  const [baseUrl, setBaseUrl] = useState(user?.baseUrl || '');
  const [selectedModel, setSelectedModel] = useState(user?.selectedModel || '');
  const [quickAccessModels, setQuickAccessModels] = useState<string[]>(user?.quickAccessModels || []);
  const [availableIntegrations, setAvailableIntegrations] = useState<Integration[]>([]);
  const [enabledIntegrations, setEnabledIntegrations] = useState<string[]>(user?.enabledIntegrations || []);
  const [isLoadingIntegrations, setIsLoadingIntegrations] = useState(false);
  const [modelConfigs, setModelConfigs] = useState<ModelConfig[]>(user?.modelConfigs || []);
  const [contextLength, setContextLength] = useState(user?.contextLength || MIN_CONTEXT);
  const [maxOutputTokens, setMaxOutputTokens] = useState(user?.maxOutputTokens || 4096);
  
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const [openConfigMenuId, setOpenConfigMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const configMenuRef = useRef<HTMLDivElement>(null);

  const [isEditingContext, setIsEditingContext] = useState(false);
  const [editableContextValue, setEditableContextValue] = useState(String(contextLength));
  const [isEditingMaxOutput, setIsEditingMaxOutput] = useState(false);
  const [editableMaxOutputValue, setEditableMaxOutputValue] = useState(String(maxOutputTokens));

  const [modelSearchQuery, setModelSearchQuery] = useState('');
  // --- Voice state ---
  const curatedVoices = [
    { id: '9BWtsMINqrJLrRacOk9x', name: 'Aria', gender: 'female' as const, description: 'Warm, conversational' },
    { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', gender: 'female' as const, description: 'Casual, personable' },
    { id: '29vD33N1CtxCmqQRPOHJ', name: 'Drew', gender: 'male' as const, description: 'Well-rounded, newsy' },
    { id: '4YYIPFl9wE5c4L2eu2Gb', name: 'Burt Reynolds™', gender: 'male' as const, description: 'Iconic, deep' },
  ];
  const [voiceId, setVoiceId] = useState(user?.voiceSettings?.voiceId || curatedVoices[0].id);
  const [voiceName, setVoiceName] = useState(user?.voiceSettings?.voiceName || curatedVoices[0].name);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const audioEl = useRef<HTMLAudioElement | null>(null);


  useEffect(() => {
    if (!isEditingContext) {
      setEditableContextValue(String(contextLength));
    }
  }, [contextLength, isEditingContext]);

  useEffect(() => {
    if (!isEditingMaxOutput) {
      setEditableMaxOutputValue(String(maxOutputTokens));
    }
  }, [maxOutputTokens, isEditingMaxOutput]);

  useEffect(() => {
    if (isOpen && user) {
      setSelectedProvider(user.selectedProvider || 'default');
      setApiKeys(user.apiKeys || []);
      setBaseUrl(user.baseUrl || '');
      setSelectedModel(user.selectedModel || '');
      setQuickAccessModels(user.quickAccessModels || []);
      setModelConfigs(user.modelConfigs || []);
      setContextLength(user.contextLength || MIN_CONTEXT);
      setMaxOutputTokens(user.maxOutputTokens || 4096);
      setEnabledIntegrations(user.enabledIntegrations || []);
      setVoiceId(user.voiceSettings?.voiceId || voiceId);
      setVoiceName(user.voiceSettings?.voiceName || voiceName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]); 

  useEffect(() => {
    if (isOpen) {
      const fetchIntegrations = async () => {
        setIsLoadingIntegrations(true);
        try {
          const response = await api('/integrations');
          if (!response.ok) throw new Error('Could not fetch integrations.');
          const data = await response.json();
          setAvailableIntegrations(data);
        } catch (error) {
          showNotification('Failed to load available integrations.', 'error');
        } finally {
          setIsLoadingIntegrations(false);
        }
      };
      fetchIntegrations();
    }
  }, [isOpen, showNotification]);

  useEffect(() => {
    // If we have models loaded and the provider is NOT default (default has implicit models)
    if (isOpen && models.length > 0 && selectedProvider !== 'default') {
      const isModelValid = models.some(m => m.id === selectedModel);
      
      // If the currently selected model isn't in the new provider's list, clear it or pick a fallback
      if (!isModelValid && selectedModel !== '') {
        // Try to keep a selection if it's in quick access, otherwise clear
        const fallback = quickAccessModels.find(qaId => models.some(m => m.id === qaId));
        setSelectedModel(fallback || '');
      }
    } else if (selectedProvider !== 'default' && models.length === 0 && !isFetching) {
      // If no models loaded yet for this provider, clear selection to avoid mismatch
      setSelectedModel('');
    }
  }, [selectedProvider, models, isOpen, quickAccessModels]);

  useEffect(() => {
    if (!isOpen) {
      setIsApiKeyVisible(false);
      setOpenConfigMenuId(null);
      setIsEditingContext(false);
      setIsEditingMaxOutput(false);
      setModelSearchQuery(''); // Reset search on close
    }
  }, [isOpen]);
  
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (configMenuRef.current && !configMenuRef.current.contains(event.target as Node)) {
        setOpenConfigMenuId(null);
      }
    };
    if (openConfigMenuId) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [openConfigMenuId]);
  
  const fetchProviderModels = useCallback(async (provider: string) => {
    // START CHANGE: Do not fetch for the default provider
    if (provider === 'default') {
        setModels([]);
        return;
    }
    // END CHANGE

    const keyForProvider = apiKeys.find(k => k.provider === provider)?.key;
    if (!keyForProvider) {
        setModels([]);
        return;
    }

    setIsFetching(true);
    setFetchError('');
    try {
        const response = await api('/models', { method: 'POST', body: JSON.stringify({ provider }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to fetch models.');
        
        setModels(data);
        
        if (selectedModel && !data.some((m: Model) => m.id === selectedModel)) {
            setSelectedModel('');
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
        setFetchError(errorMessage);
        showNotification(errorMessage, 'error');
        setModels([]);
    } finally {
        setIsFetching(false);
    }
  }, [apiKeys, selectedModel, setModels, showNotification]);

  useEffect(() => {
    setFetchError('');
    setModels([]); 
    
    fetchProviderModels(selectedProvider);
  }, [selectedProvider, fetchProviderModels, setModels]);

  const handleApiKeyChange = (newKey: string) => {
    setApiKeys(prev => {
      const otherKeys = prev.filter(k => k.provider !== selectedProvider);
      if (newKey) {
        return [...otherKeys, { provider: selectedProvider, key: newKey }];
      }
      return otherKeys;
    });
  };
  
  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 300);
  };

  const handleManualFetch = async () => {
    const currentApiKey = apiKeys.find(k => k.provider === selectedProvider)?.key;
    if (!currentApiKey) {
      const providerName = providers.find(p => p.id === selectedProvider)?.name || 'Current provider';
      setFetchError(`${providerName} API Key is required to fetch models.`);
      return;
    }
    await updateSettings({ apiKeys, baseUrl });
    await fetchProviderModels(selectedProvider);
  };

  const handleSave = async () => {
    // START CHANGE: Adjust validation for default provider
    if (selectedProvider !== 'default' && quickAccessModels.length > 0 && !selectedModel) {
        showNotification('Please select a default model from your Quick Access list.', 'error');
        return;
    }
    // END CHANGE
    try {
      const configsToSave = modelConfigs.filter(config => quickAccessModels.includes(config.id));

      if (selectedProvider === "default") {
        configsToSave.push({id: "default", modalities: ["text", "image"]})
        setModelConfigs(prevConfigs => {
            const modelConfigIndex = prevConfigs.findIndex(c => c.id === "default");

            if (modelConfigIndex > -1) {
              prevConfigs[modelConfigIndex] = {id: "default", modalities: ["text", "image"]}
            } else {
              prevConfigs.push({id: "default", modalities: ["text", "image"]})
            }
            return prevConfigs;
        })
      }
      
      // START CHANGE: Only save relevant settings based on provider
      const settingsToSave = {
        selectedProvider,
        apiKeys,
        baseUrl: selectedProvider === 'openai' ? baseUrl : '',
        modelConfigs: configsToSave,
        contextLength,
        maxOutputTokens,
        selectedModel: selectedProvider === 'default' 
          ? 'default' 
          : selectedModel,
        ...(selectedProvider !== 'default' && {
          quickAccessModels,
        }),
        enabledIntegrations,
        voiceSettings: { voiceId, voiceName },
      };
      
      await updateSettings(settingsToSave);
      // END CHANGE

      showNotification('Settings Saved!');
      handleClose();
    } catch (err) {
      showNotification(`Failed to save settings.\n${err}`, "error");
    }
  };
  const previewVoice = async (id: string, name: string) => {
    setPreviewingId(id);
    try {
      // Try local pre-downloaded preview first to avoid API cost
      const tryLocal = async (): Promise<boolean> => {
        const exts = ['mp3', 'ogg', 'wav'];
        for (const ext of exts) {
          const url = `/voices/${id}.${ext}`;
          try {
            const resp = await fetch(url, { method: 'GET' });
            if (resp.ok) {
              if (!audioEl.current) audioEl.current = new Audio();
              audioEl.current.src = `${url}?v=${Date.now()}`; // bust cache during dev
              await audioEl.current.play();
              return true;
            }
          } catch (_) {
            // try next extension
          }
        }
        return false;
      };

      const playedLocal = await tryLocal();
      if (playedLocal) return;

      // Fallback: call server TTS preview
      if (!audioEl.current) audioEl.current = new Audio();
      const res = await api('/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({
          text: `Hi, I am ${name}. This is a sample of my voice.`,
          voiceId: id,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err?.error || 'Could not preview voice');
      }
      const buf = await res.arrayBuffer();
      const blob = new Blob([buf], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      audioEl.current.src = url;
      await audioEl.current.play();
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Failed to preview voice', 'error');
    } finally {
      setPreviewingId(null);
    }
  };

  const renderVoiceTab = () => {
    const isPro = user?.subscriptionStatus === 'active';
    return (
      <>
        <h3>Voice</h3>
        <p>Choose how the assistant sounds. Preview each voice and pick your favorite.</p>
        {!isPro && (
          <div className="upgrade-prompt">
            <FiStar size={18} />
            <span>Voice is a Pro feature.</span>
            <button onClick={handleUpgrade}>Upgrade to Pro</button>
          </div>
        )}

        <div className="voice-grid">
          {curatedVoices.map(v => (
            <div key={v.id} className={`voice-card ${voiceId === v.id ? 'selected' : ''}`} onClick={() => { setVoiceId(v.id); setVoiceName(v.name);} }>
              <div className="voice-card-header">
                <div className={`voice-gender ${v.gender}`}></div>
                <h4>{v.name}</h4>
              </div>
              <p className="voice-desc">{v.description}</p>
              <div className="voice-actions">
                <button className="preview-btn" onClick={(e) => { e.stopPropagation(); previewVoice(v.id, v.name); }} disabled={!isPro || !!previewingId}>
                  {previewingId === v.id ? <FiPause /> : <FiPlay />} Preview
                </button>
                <label className="select-radio">
                  <input type="radio" checked={voiceId === v.id} onChange={() => { setVoiceId(v.id); setVoiceName(v.name);} } disabled={!isPro} />
                  <span>Use</span>
                </label>
              </div>
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button className="modal-button modal-button-cancel" onClick={handleClose}>Cancel</button>
          <button className="modal-button modal-button-save" onClick={handleSave}>
            <FiVolume2 style={{marginRight: 8}}/> Save & Close
          </button>
        </div>
      </>
    );
  };

  const handleIntegrationToggle = (integrationId: string) => {
    setEnabledIntegrations(prev =>
      prev.includes(integrationId)
        ? prev.filter(id => id !== integrationId)
        : [...prev, integrationId]
    );
  };
  
  const handleQuickAccessChange = (modelId: string) => {
    if (quickAccessModels.includes(modelId)) {
        if (selectedModel === modelId) {
            setSelectedModel('');
        }
    }

    setQuickAccessModels(prev => 
      prev.includes(modelId)
        ? prev.filter(id => id !== modelId)
        : [...prev, modelId]
    );
  };
  
  const handleModalityChange = (modelId: string, modalityToToggle: Modality, isEnabled: boolean) => {
    setModelConfigs(prevConfigs => {
      const newConfigs = [...prevConfigs];
      const configIndex = newConfigs.findIndex(c => c.id === modelId);

      if (configIndex > -1) {
        const configToUpdate = { ...newConfigs[configIndex] };
        const modalitiesSet = new Set(configToUpdate.modalities);
        if (isEnabled) modalitiesSet.add(modalityToToggle); else modalitiesSet.delete(modalityToToggle);
        configToUpdate.modalities = Array.from(modalitiesSet);
        newConfigs[configIndex] = configToUpdate;
      } else {
        const newModalities: Modality[] = ['text'];
        if (isEnabled) newModalities.push(modalityToToggle);
        newConfigs.push({ id: modelId, modalities: newModalities });
      }
      return newConfigs;
    });
  };

  const handleMenuToggle = (modelId: string, event: React.MouseEvent<HTMLButtonElement>) => {
    if (openConfigMenuId === modelId) {
      setOpenConfigMenuId(null);
    } else {
      const rect = event.currentTarget.getBoundingClientRect();
      setMenuPosition({ top: rect.bottom + window.scrollY + 5, left: rect.left + window.scrollX });
      setOpenConfigMenuId(modelId);
    }
  };

  const handleProcessAndSetContextValue = () => {
    let numValue = parseInt(editableContextValue, 10);
    if (isNaN(numValue)) {
      numValue = contextLength;
    }
    const clampedValue = Math.max(MIN_CONTEXT, Math.min(numValue, MAX_CONTEXT));
    setContextLength(clampedValue);
    setIsEditingContext(false);
  };

  const handleContextInputBlur = () => {
    handleProcessAndSetContextValue();
  };

  const handleContextInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleProcessAndSetContextValue();
    } else if (e.key === 'Escape') {
      setEditableContextValue(String(contextLength));
      setIsEditingContext(false);
    }
  };

  const handleProcessAndSetMaxOutput = () => {
    let numValue = parseInt(editableMaxOutputValue, 10);
    if (isNaN(numValue)) {
      numValue = maxOutputTokens;
    }
    const clampedValue = Math.max(MIN_OUTPUT_TOKENS, Math.min(numValue, MAX_OUTPUT_TOKENS));
    setMaxOutputTokens(clampedValue);
    setIsEditingMaxOutput(false);
  };

  const handleMaxOutputInputBlur = () => {
    handleProcessAndSetMaxOutput();
  };

  const handleMaxOutputInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleProcessAndSetMaxOutput();
    } else if (e.key === 'Escape') {
      setEditableMaxOutputValue(String(maxOutputTokens));
      setIsEditingMaxOutput(false);
    }
  };

  if (!isOpen) return null;

  const renderIntegrationsTab = () => {
    const isPro = user?.subscriptionStatus === 'active';

    return (
      <>
        <h3>Integrations</h3>
        <p>Connect Lyseris to other services. Available for Pro users.</p>
        
        {!isPro && (
          <div className="upgrade-prompt">
            <FiStar size={18} />
            <span>Integrations are a Pro feature.</span>
            <button onClick={handleUpgrade}>Upgrade to Pro</button>
          </div>
        )}

        <div className="integrations-list">
          {isLoadingIntegrations ? (
            <p>Loading...</p>
          ) : availableIntegrations.length > 0 ? (
            availableIntegrations.map((integration) => (
              <div key={integration.id} className="integration-card">
                <div className="integration-info">
                  <h4>{integration.name}</h4>
                  <p>{integration.description}</p>
                </div>
                <div className="integration-toggle">
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={enabledIntegrations.includes(integration.id)}
                      onChange={() => handleIntegrationToggle(integration.id)}
                      disabled={!isPro}
                    />
                    <span className="slider round"></span>
                  </label>
                </div>
              </div>
            ))
          ) : (
            <p>No integrations are currently available.</p>
          )}
        </div>

        <div className="modal-actions">
          <button className="modal-button modal-button-cancel" onClick={handleClose}>Cancel</button>
          <button className="modal-button modal-button-save" onClick={handleSave}>Save & Close</button>
        </div>
      </>
    );
  };

  const renderGptTab = () => {
    const isDefaultProviderSelected = selectedProvider === 'default';
    const currentApiKey = apiKeys.find(k => k.provider === selectedProvider)?.key || '';
    const defaultModelOptions = models.filter(model => quickAccessModels.includes(model.id));
    const filteredModels = models.filter(model => 
        model.id.toLowerCase().includes(modelSearchQuery.toLowerCase())
    );
    const getApiKeyPlaceholder = () => {
        switch (selectedProvider) {
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
      
       <div className="form-group">
        <label>Provider</label>
        <ProviderSelector 
            providers={providers}
            selectedProvider={selectedProvider}
            onSelect={(id) => setSelectedProvider(id)}
        />
      </div>

      {isDefaultProviderSelected ? (
        <div className="form-group default-provider-info">
          <p className="description">
            You are using free Gemini 2.5 Flash model.
          </p>
          <p>
            Rate limits spread across all users.
          </p>
        </div>
      ) : (
        <>
          <div className="form-group">
            <label htmlFor="apiKey">API Key</label>
            <div className="input-wrapper">
              <input 
                id="apiKey" 
                type={isApiKeyVisible ? 'text' : 'password'}
                className={!isApiKeyVisible ? 'input-hidden' : ''}
                value={currentApiKey} 
                onChange={(e) => handleApiKeyChange(e.target.value)} 
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

          {(selectedProvider === 'openai') && (
            <div className="form-group">
              <label htmlFor="baseUrl">Base URL (optional)</label>
              <input 
                  id="baseUrl" 
                  type="text" 
                  value={baseUrl} 
                  onChange={(e) => setBaseUrl(e.target.value)} 
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
                  onBlur={handleContextInputBlur}
                  onKeyDown={handleContextInputKeyDown}
                  className="context-value-input"
                  autoFocus
                  onFocus={(e) => e.target.select()}
                />
              ) : (
                <span
                  onClick={() => setIsEditingContext(true)}
                  className="context-value-span"
                >
                  {contextLength}
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
                    value={contextLength}
                    onChange={(e) => setContextLength(parseInt(e.target.value, 10))}
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
                  onBlur={handleMaxOutputInputBlur}
                  onKeyDown={handleMaxOutputInputKeyDown}
                  className="context-value-input"
                  autoFocus
                  onFocus={(e) => e.target.select()}
                />
              ) : (
                <span
                  onClick={() => setIsEditingMaxOutput(true)}
                  className="context-value-span"
                >
                  {maxOutputTokens}
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
                    value={maxOutputTokens}
                    onChange={(e) => setMaxOutputTokens(parseInt(e.target.value, 10))}
                    className="context-slider"
                />
            </div>
          </div>

          {models.length > 0 && (
            <>
            <div className="form-group">
              <label>Quick Access Models</label>
              <p className="description">Select which models appear in the top-of-screen selector. Only models selected here can be set as the default.</p>
              
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
              <div className="quick-access-list">
                {filteredModels.length > 0 ? (
                  filteredModels.map(model => {
                    const config = modelConfigs.find(c => c.id === model.id) || { modalities: ['text'] };
                    const hasImageModality = config.modalities.some(modality => modality === 'image');

                    return (
                    <div key={model.id} className="quick-access-row">
                      <label className="quick-access-item">
                        <input type="checkbox" checked={quickAccessModels.includes(model.id)} onChange={() => handleQuickAccessChange(model.id)} />
                        <span className="checkbox-visual"></span>
                        <span className="model-name-text">{model.id}</span>
                      </label>
                      <div className="model-config-wrapper">
                        <button className="model-config-button" onClick={(e) => handleMenuToggle(model.id, e)} disabled={!quickAccessModels.includes(model.id)}>
                          <FiMoreVertical size={16}/>
                        </button>
                        {openConfigMenuId === model.id && (
                          <Portal>
                            <div className="model-config-menu" ref={configMenuRef} style={{ position: 'absolute', top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }}>
                              <label className="config-menu-item">
                                  <input type="checkbox" checked disabled />
                                  <span className="checkbox-visual"></span>
                                  <span>Text</span>
                              </label>
                              <label className="config-menu-item">
                                  <input type="checkbox" checked={hasImageModality} onChange={(e) => handleModalityChange(model.id, 'image', e.target.checked)} />
                                  <span className="checkbox-visual"></span>
                                  <span>Image</span>
                              </label>
                            </div>
                          </Portal>
                        )}
                      </div>
                    </div>
                    );
                  })
                ) : (
                  <div className="no-models-found">
                    No models found matching your search.
                  </div>
                )}
              </div>
            </div>

            <div className="form-group">
                <label htmlFor="model">Default Model</label>
                <div className="model-select-wrapper">
                <CustomModelSelector
                    models={defaultModelOptions}
                    selectedModel={selectedModel}
                    onSelect={setSelectedModel}
                    disabled={defaultModelOptions.length === 0}
                    placeholderText="Select from Quick Access models"
                />
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
            </div>
            </>
          )}

          {models.length === 0 && (
             <div className="form-group">
                <label htmlFor="model">Models</label>
                <div className="model-select-wrapper">
                    <div className="placeholder-selector">
                        {isFetching ? 'Loading models...' : 'Click Refresh to load available models'}
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
      
      <div className="modal-actions">
        <button className="modal-button modal-button-cancel" onClick={handleClose}>Cancel</button>
        <button className="modal-button modal-button-save" onClick={handleSave}>Save & Close</button>
      </div>
    </>
    );
  };
  
  const handleManageSubscription = async () => {
    try {
      const response = await api('/stripe/create-portal-session', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.msg || 'Could not open management portal.');
      window.location.href = data.url;
    } catch (error) {
      showNotification(error instanceof Error ? error.message : 'An error occurred.', 'error');
    }
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

  return (
    <div className={`modal-overlay ${isClosing ? 'closing' : ''}`} onClick={handleClose}>
      <div className={`modal-content ${isClosing ? 'closing' : ''}`} onClick={(e) => e.stopPropagation()}>
        <aside className="settings-sidebar">
          <h2>Settings</h2>
          <button className={`settings-tab-button ${activeTab === 'GPT' ? 'active' : ''}`} onClick={() => setActiveTab('GPT')}>
            <FiCpu size={18} />
            <span>GPT</span>
          </button>
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
          {activeTab === 'GPT' && renderGptTab()}
          {activeTab === 'Integrations' && renderIntegrationsTab()}
          {activeTab === 'Subscription' && renderSubscriptionTab()}
          {activeTab === 'Appearance' && renderAppearanceTab()}
          {activeTab === 'Voice' && renderVoiceTab()}
        </main>
      </div>
    </div>
  );
};

export default SettingsModal;
