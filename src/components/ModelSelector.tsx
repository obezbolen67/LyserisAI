import { useState, useRef, useEffect } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { FiChevronDown, FiCheck } from 'react-icons/fi';
import OpenAIIcon from '../icons/openai.svg?react';
import AnthropicIcon from '../icons/anthropic.svg?react';
import GeminiIcon from '../icons/gemini.svg?react';
import api from '../utils/api';
import '../css/ModelSelector.css';

type ActiveModelEntry = {
  id: string;
  provider: string;
  isDefault: boolean;
  creditsPer1kTokens?: number;
  intelligenceLevel?: number;
  displayName?: string;
  description?: string;
};

type OpenRouterModelMeta = {
  id: string;
  name?: string;
  description?: string;
};

const buildModelMetaKey = (provider: string, modelId: string) => `${provider}:${modelId}`;

const humanizeModelName = (modelId: string) => {
  const tail = String(modelId || '').split('/').pop() || modelId;
  return tail
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const providerIconMap: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  openai: OpenAIIcon,
  anthropic: AnthropicIcon,
  gemini: GeminiIcon,
  default: GeminiIcon,
  openrouter: OpenAIIcon,
};

const DEFAULT_OPENROUTER_MODELS = [
  {
    id: 'openai/gpt-5-mini',
    provider: 'openrouter',
    tier: 'cheap',
    displayName: 'GPT-5 Mini',
    creditsPer1kTokens: 0.5,
    intelligenceLevel: 4,
  },
  {
    id: 'moonshotai/kimi-k2.5',
    provider: 'openrouter',
    tier: 'medium',
    displayName: 'Kimi K2.5',
    creditsPer1kTokens: 1,
    intelligenceLevel: 6,
  },
  {
    id: 'openai/gpt-5.3-chat',
    provider: 'openrouter',
    tier: 'expensive',
    displayName: 'GPT-5.3 Chat',
    creditsPer1kTokens: 2.5,
    intelligenceLevel: 8,
  },
];

const getIntelligenceColor = (level: number) => {
  const clamped = Math.min(10, Math.max(1, level));
  const hue = Math.round(((clamped - 1) / 9) * 120);
  return `hsl(${hue}, 78%, 45%)`;
};

const getIntelligenceBars = (level: number) => {
  const clamped = Math.min(10, Math.max(1, level));
  return Math.max(1, Math.round(clamped / 2));
};

const ModelSelector = () => {
  const { user, selectedModel, updateSettings, loading } = useSettings();
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredModel, setHoveredModel] = useState<ActiveModelEntry | null>(null);
  const [tooltipTop, setTooltipTop] = useState<number | null>(null);
  const [modelMetaByKey, setModelMetaByKey] = useState<Record<string, OpenRouterModelMeta>>({});
  const hoverTimeoutRef = useRef<number | null>(null);
  const selectorRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    const loadProviderMetadata = async () => {
      try {
        const quickAccessModelIds = user?.quickAccessModels || [];
        const modelConfigs = user?.modelConfigs || [];
        const providerConfigs = user?.providerConfigs || [];
        const enabledProviderIds = new Set(
          providerConfigs
            .filter((config) => config.provider !== 'default' && config.enabled !== false)
            .map((config) => config.provider)
        );

        const providersToFetch = new Set<string>(['openrouter']);
        quickAccessModelIds.forEach((modelId) => {
          const providerId = modelConfigs.find((config) => config.id === modelId)?.provider || 'openai';
          if (enabledProviderIds.has(providerId)) {
            providersToFetch.add(providerId);
          }
        });

        const responses = await Promise.all(
          Array.from(providersToFetch).map(async (providerId) => {
            const res = await api('/models', {
              method: 'POST',
              body: JSON.stringify({ provider: providerId }),
            });
            if (!res.ok) {
              return { providerId, entries: [] as OpenRouterModelMeta[] };
            }
            const payload = await res.json();
            const entries = Array.isArray(payload) ? payload : [];
            return { providerId, entries };
          })
        );

        const nextMetaByKey: Record<string, OpenRouterModelMeta> = {};
        responses.forEach(({ providerId, entries }) => {
          entries.forEach((entry: OpenRouterModelMeta) => {
            if (entry?.id) {
              nextMetaByKey[buildModelMetaKey(providerId, entry.id)] = {
                id: entry.id,
                name: typeof entry.name === 'string' ? entry.name : undefined,
                description: typeof entry.description === 'string' ? entry.description : undefined,
              };
            }
          });
        });

        if (!cancelled) {
          setModelMetaByKey(nextMetaByKey);
        }
      } catch {
        // Metadata is optional, keep local fallback labels.
      }
    };

    loadProviderMetadata();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const quickAccessModelIds = user?.quickAccessModels || [];
  const enabledProviders = new Set(
    (user?.providerConfigs || [])
      .filter((config) => config.provider !== 'default' && config.enabled !== false)
      .map((config) => config.provider)
  );

  // Group 1: Default Models
  const defaultModels: ActiveModelEntry[] = DEFAULT_OPENROUTER_MODELS.map((model) => {
    const fetchedModel = modelMetaByKey[buildModelMetaKey(model.provider, model.id)];
    return {
      id: model.id,
      provider: model.provider,
      isDefault: true,
      creditsPer1kTokens: model.creditsPer1kTokens,
      intelligenceLevel: model.intelligenceLevel,
      displayName: fetchedModel?.name || model.displayName || humanizeModelName(model.id),
      description: fetchedModel?.description,
    };
  }).sort((a, b) => (b.intelligenceLevel || 0) - (a.intelligenceLevel || 0));

  // Group 2: Other user-selected models
  const otherModels: ActiveModelEntry[] = quickAccessModelIds
    .map((modelId) => {
      const modelConfig = user?.modelConfigs?.find((config) => config.id === modelId);
      const providerId = modelConfig?.provider || 'openai';
      const modelMeta = modelMetaByKey[buildModelMetaKey(providerId, modelId)];
      return {
        id: modelId,
        provider: providerId,
        isDefault: false,
        displayName: modelMeta?.name || humanizeModelName(modelId),
        description: modelMeta?.description,
      };
    })
    .filter(
      (entry) =>
        enabledProviders.has(entry.provider) &&
        !defaultModels.some((dm) => dm.id === entry.id && dm.provider === entry.provider)
    );

  const activeModels = [...defaultModels, ...otherModels];

  const handleSelectModel = async (modelId: string, e: React.MouseEvent) => {
    // Prevent event bubbling and default behavior to ensure the action captures
    e.preventDefault();
    e.stopPropagation();
    
    if (modelId !== selectedModel) {
      await updateSettings({ selectedModel: modelId });
    }
    setIsOpen(false);
  };
  
  useEffect(() => {
    if (!loading && !selectedModel && activeModels.length > 0) {
      updateSettings({ selectedModel: activeModels[0].id }).catch(() => {});
    }
  }, [activeModels, loading, selectedModel, updateSettings]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleMouseEnter = (model: ActiveModelEntry, event: React.MouseEvent<HTMLDivElement>) => {
    if (hoverTimeoutRef.current !== null) {
      window.clearTimeout(hoverTimeoutRef.current);
    }

    const dropdownRect = dropdownRef.current?.getBoundingClientRect();
    const rowRect = event.currentTarget.getBoundingClientRect();
    if (dropdownRect) {
      setTooltipTop(rowRect.top - dropdownRect.top + rowRect.height / 2);
    }

    hoverTimeoutRef.current = window.setTimeout(() => {
      setHoveredModel(model);
    }, 500); // 500ms delay for tooltip
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current !== null) {
      window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setHoveredModel(null);
    setTooltipTop(null);
  };
  
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current !== null) {
        window.clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  if (loading) {
    return <div className="model-selector-placeholder" />;
  }

  return (
    <div className="model-selector" ref={selectorRef}>
      <button 
        className="model-selector-button" 
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <span>Lyseris AI</span>
        <span className="beta-tag">Beta</span>
        <FiChevronDown size={16} className={isOpen ? 'open' : ''} />
      </button>

      {isOpen && (
        <div className="model-selector-dropdown" ref={dropdownRef}>
          {defaultModels.map((model) => {
            return (
              <div 
                key={`default:${model.provider}:${model.id}`}
                className={`model-item ${selectedModel === model.id ? 'selected' : ''}`}
                onMouseDown={(e) => handleSelectModel(model.id, e)}
                onMouseEnter={(event) => handleMouseEnter(model, event)}
                onMouseLeave={handleMouseLeave}
                role="button"
                tabIndex={0}
              >
                <img src="/lyseris.svg" alt="Lyseris" className="model-item-icon model-item-site-icon" />
                <div className="model-item-details">
                  <span className="model-item-name">{model.displayName || model.id}</span>
                </div>
                {selectedModel === model.id && <FiCheck size={18} className="model-item-check" />}
              </div>
            );
          })}

          {otherModels.length > 0 && <div className="model-selector-divider" />}

          {otherModels.map((model) => {
              const ProviderIcon = providerIconMap[model.provider];
              return (
                <div 
                  key={`${model.provider}:${model.id}`}
                  className={`model-item ${selectedModel === model.id ? 'selected' : ''}`}
                  // Use onMouseDown to trigger before blur/focusout events
                  onMouseDown={(e) => handleSelectModel(model.id, e)}
                  onMouseEnter={(event) => handleMouseEnter(model, event)}
                  onMouseLeave={handleMouseLeave}
                  role="button"
                  tabIndex={0}
                >
                  {ProviderIcon ? (
                    <ProviderIcon className="model-item-icon provider-model-icon" />
                  ) : (
                    <div className="model-item-icon provider-icon-fallback">{model.provider.charAt(0).toUpperCase()}</div>
                  )}
                  <div className="model-item-details">
                    <span className="model-item-name">{model.displayName || model.id}</span>
                    <span className="model-item-description">{model.provider}</span>
                  </div>
                  {selectedModel === model.id && <FiCheck size={18} className="model-item-check" />}
                </div>
              );
          })}
          
          {activeModels.length === 0 && (
             <div className="model-item-empty">
               Configure Active Models in Settings.
             </div>
          )}

          {hoveredModel && (hoveredModel.isDefault || hoveredModel.description) && (
            <div className="model-hover-tooltip" style={{ top: tooltipTop ?? undefined }}>
              <div className="tooltip-header">{hoveredModel.displayName || hoveredModel.id}</div>
              <div className="tooltip-stats">
                {hoveredModel.isDefault && hoveredModel.creditsPer1kTokens !== undefined && (
                  <div className="tooltip-stat">
                    <span className="stat-label">Cost</span>
                    <span className="stat-value">{hoveredModel.creditsPer1kTokens}x</span>
                  </div>
                )}
                {hoveredModel.isDefault && hoveredModel.intelligenceLevel !== undefined && (
                  <div className="tooltip-stat">
                    <span className="stat-label">Intelligence</span>
                    <span className="stat-value intelligence-value">
                      <span className="intelligence-meter" aria-hidden="true">
                        {[0, 1, 2, 3, 4].map((barIndex) => {
                          const activeBars = getIntelligenceBars(hoveredModel.intelligenceLevel || 1);
                          const isActive = barIndex < activeBars;
                          return (
                            <span
                              key={barIndex}
                              className={`intelligence-bar ${isActive ? 'active' : ''}`}
                              style={isActive ? { backgroundColor: getIntelligenceColor(hoveredModel.intelligenceLevel || 1) } : undefined}
                            />
                          );
                        })}
                      </span>
                    </span>
                  </div>
                )}
              </div>
              {hoveredModel.description && (
                <>
                  <div className="tooltip-divider" />
                  <div className="tooltip-description">{hoveredModel.description}</div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ModelSelector;
