import { useState, useRef, useEffect, type FC, type SVGProps } from 'react';
import { FiChevronDown, FiPlus } from 'react-icons/fi';
import '../css/ProviderSelector.css';

export type Provider = {
  id: string;
  name: string;
  Icon?: FC<SVGProps<SVGSVGElement>>;
};

interface ProviderSelectorProps {
  providers: Provider[];
  selectedProvider: string;
  onSelect: (providerId: string) => void;
  onAddProvider?: () => void;
}

const ProviderSelector: FC<ProviderSelectorProps> = ({ providers, selectedProvider, onSelect, onAddProvider }) => {
  const [isOpen, setIsOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  const currentProvider = providers.find(p => p.id === selectedProvider) || providers[0];

  const handleSelect = (providerId: string) => {
    onSelect(providerId);
    setIsOpen(false);
  };
  
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="provider-selector" ref={selectorRef}>
      <div className="provider-selector-controls">
        {onAddProvider && (
          <button
            type="button"
            className="provider-add-button"
            onClick={onAddProvider}
            aria-label="Add custom provider"
            title="Add custom provider"
          >
            <FiPlus size={18} />
          </button>
        )}
        <button className="provider-selector-button" onClick={() => setIsOpen(!isOpen)}>
          <div className="provider-info">
            {currentProvider.Icon ? (
              <currentProvider.Icon className="provider-icon" />
            ) : (
              <div className="provider-icon provider-icon-fallback">{currentProvider.name.charAt(0).toUpperCase()}</div>
            )}
            <span>{currentProvider.name}</span>
          </div>
          <FiChevronDown size={20} className={`chevron-icon ${isOpen ? 'open' : ''}`} />
        </button>
      </div>

      {isOpen && (
        <div className="provider-selector-dropdown">
          {providers.map(provider => (
            <div 
              key={provider.id}
              className={`provider-item ${selectedProvider === provider.id ? 'selected' : ''}`}
              onClick={() => handleSelect(provider.id)}
            >
              {provider.Icon ? (
                <provider.Icon className="provider-icon" />
              ) : (
                <div className="provider-icon provider-icon-fallback">{provider.name.charAt(0).toUpperCase()}</div>
              )}
              <span>{provider.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProviderSelector;