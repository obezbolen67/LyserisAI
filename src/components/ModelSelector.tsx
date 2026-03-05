import { useState, useRef, useEffect } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { FiChevronDown, FiCheck } from 'react-icons/fi';
import OpenAIIcon from '../icons/openai.svg?react';
import AnthropicIcon from '../icons/anthropic.svg?react';
import GeminiIcon from '../icons/gemini.svg?react';
import '../css/ModelSelector.css';

type ActiveModelEntry = {
  id: string;
  provider: string;
};

const providerIconMap: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  openai: OpenAIIcon,
  anthropic: AnthropicIcon,
  gemini: GeminiIcon,
  default: GeminiIcon,
};

const ModelSelector = () => {
  const { user, selectedModel, updateSettings, loading } = useSettings();
  const [isOpen, setIsOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  const quickAccessModelIds = user?.quickAccessModels || [];
  const enabledProviders = new Set(
    (user?.providerConfigs || [])
      .filter((config) => config.provider !== 'default' && config.enabled !== false)
      .map((config) => config.provider)
  );

  const activeModels: ActiveModelEntry[] = quickAccessModelIds
    .map((modelId) => {
      const modelConfig = user?.modelConfigs?.find((config) => config.id === modelId);
      return {
        id: modelId,
        provider: modelConfig?.provider || 'openai',
      };
    })
    .filter((entry) => enabledProviders.has(entry.provider));

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
        <div className="model-selector-dropdown">
          {activeModels.length > 0 ? (
            activeModels.map((model) => {
              const ProviderIcon = providerIconMap[model.provider];
              return (
                <div 
                  key={`${model.provider}:${model.id}`}
                  className={`model-item ${selectedModel === model.id ? 'selected' : ''}`}
                  // Use onMouseDown to trigger before blur/focusout events
                  onMouseDown={(e) => handleSelectModel(model.id, e)}
                  role="button"
                  tabIndex={0}
                >
                  {ProviderIcon ? (
                    <ProviderIcon className="model-item-icon provider-model-icon" />
                  ) : (
                    <div className="model-item-icon provider-icon-fallback">{model.provider.charAt(0).toUpperCase()}</div>
                  )}
                  <div className="model-item-details">
                    <span className="model-item-name">{model.id}</span>
                    <span className="model-item-description">{model.provider}</span>
                  </div>
                  {selectedModel === model.id && <FiCheck size={18} className="model-item-check" />}
                </div>
              );
            })
          ) : (
            <div className="model-item-empty">
              Configure Active Models in Settings.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ModelSelector;
