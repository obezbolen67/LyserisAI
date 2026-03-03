import { useState, useRef, useEffect } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { FiChevronDown, FiCheck, FiCpu } from 'react-icons/fi';
import '../css/ModelSelector.css';

const ModelSelector = () => {
  const { user, models, selectedModel, updateSettings, loading } = useSettings();
  const [isOpen, setIsOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  const quickAccessModelIds = user?.quickAccessModels || [];
  const quickAccessModels = models.filter(m => quickAccessModelIds.includes(m.id));

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

  const getModelInfo = () => {
    return {
      Icon: FiCpu,
      description: "",
    };
  };

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
          {quickAccessModels.length > 0 ? (
            quickAccessModels.map(model => {
              const { Icon, description } = getModelInfo();
              return (
                <div 
                  key={model.id}
                  className={`model-item ${selectedModel === model.id ? 'selected' : ''}`}
                  // Use onMouseDown to trigger before blur/focusout events
                  onMouseDown={(e) => handleSelectModel(model.id, e)}
                  role="button"
                  tabIndex={0}
                >
                  <Icon size={20} className="model-item-icon" />
                  <div className="model-item-details">
                    <span className="model-item-name">{model.id}</span>
                    <span className="model-item-description">{description}</span>
                  </div>
                  {selectedModel === model.id && <FiCheck size={18} className="model-item-check" />}
                </div>
              );
            })
          ) : (
            <div className="model-item-empty">
              Configure quick access models in Settings.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ModelSelector;
