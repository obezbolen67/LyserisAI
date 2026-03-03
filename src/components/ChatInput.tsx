import { useState, useRef, useEffect, memo } from 'react';
import { FiPlus, FiSend, FiX, FiImage, FiPaperclip, FiSquare } from 'react-icons/fi';
import { HiOutlineMicrophone } from "react-icons/hi2";
import { uploadFile } from '../utils/api';
import type { Attachment } from '../types';
import '../css/ChatInput.css';
import Tooltip from './Tooltip';
import { useSettings } from '../contexts/SettingsContext';
import { useNotification } from '../contexts/NotificationContext';
import { getFileIcon } from '../utils/fileIcons';
import VoiceChatModal from './VoiceChatModal';
import { useChat } from '../contexts/ChatContext';
import ThinkingIcon from '../icons/thinking.svg?react';

interface ChatInputProps {
  onSendMessage: (text: string, attachments: Attachment[], metadata?: Record<string, any>) => void;
  onStopGeneration: () => void;
  isSending: boolean;
  isThinkingVisible: boolean;
}

// --- HELPER: Generate Thumbnail ---
const generateThumbnail = async (file: File): Promise<string> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxWidth = 150; // Thumbnail size
        const scale = maxWidth / img.width;
        // If image is already small, don't resize
        if (scale >= 1) {
            resolve(e.target?.result as string);
            return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = maxWidth;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL(file.type));
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
};

// --- SUB-COMPONENT: Attachment Preview Item ---
// Handles async thumbnail generation to prevent blocking the main render loop
const AttachmentPreviewItem = memo(({ file, onRemove }: { file: File, onRemove: (f: File) => void }) => {
    const [thumbnailSrc, setThumbnailSrc] = useState<string | null>(null);
    const isImage = file.type.startsWith('image/');
  
    useEffect(() => {
      let active = true;
      if (isImage) {
        generateThumbnail(file).then(src => {
          if (active) setThumbnailSrc(src);
        });
      }
      return () => { active = false; };
    }, [file, isImage]);
  
    return (
      <div className="attachment-preview-wrapper">
        {isImage ? (
          <div className="attachment-thumbnail">
            {thumbnailSrc ? (
                <img src={thumbnailSrc} alt={file.name} />
            ) : (
                <div className="skeleton-loader" style={{width: '100%', height: '100%', background: 'rgba(128,128,128,0.1)'}}></div>
            )}
          </div>
        ) : (
          <div className="attachment-file-preview">
            <div className="file-preview-icon">{getFileIcon(file.type)}</div>
            <span className="file-preview-name">{file.name}</span>
          </div>
        )}
        <Tooltip text={`Remove ${file.name}`}>
          <button onClick={() => onRemove(file)} className="remove-attachment-btn">
            <FiX size={14} />
          </button>
        </Tooltip>
      </div>
    );
});

const ChatInput = ({ onSendMessage, onStopGeneration, isSending, isThinkingVisible }: ChatInputProps) => {
  const { user, selectedModel } = useSettings();
  const { showNotification } = useNotification();
  const { isThinkingEnabled, toggleThinking } = useChat();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [text, setText] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isVoiceChatOpen, setIsVoiceChatOpen] = useState(false);
  const isProUser = user?.subscriptionStatus === 'active';
  const voiceTooltip = isProUser ? 'Voice Chat' : 'Voice chat is available for Pro users only';

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const plusButtonRef = useRef<HTMLButtonElement>(null);
  const dragCounterRef = useRef(0);

  const hasContent = text.trim().length > 0 || selectedFiles.length > 0;
  const isGenerating = isSending;

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(event.target as Node) &&
        plusButtonRef.current && !plusButtonRef.current.contains(event.target as Node)
      ) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);

  const validateAndAddFiles = (files: File[]) => {
    const containsImage = files.some(f => f.type.startsWith('image/'));

    if (containsImage) {
      const modelConfigs = user?.modelConfigs || [];
      const modelConfig = modelConfigs.find(c => c.id === selectedModel);
      const supportsImage = modelConfig?.modalities.includes('image');

      if (!supportsImage) {
        showNotification('This model does not support image inputs. Please select a vision-capable model.', 'error');
        return;
      }
    }

    const remainingSlots = 10 - selectedFiles.length;
    if (remainingSlots <= 0) {
      showNotification('Maximum 10 files allowed', 'error');
      return;
    }

    const filesToAdd = files.slice(0, remainingSlots);
    setSelectedFiles(prev => [...prev, ...filesToAdd]);
    
    if (files.length > remainingSlots) {
      showNotification(`Only ${remainingSlots} file(s) added. Maximum 10 files allowed.`, 'error');
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const files = Array.from(event.target.files);
      validateAndAddFiles(files);
    }
    event.target.value = '';
  };

  // Handle paste events
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const files: File[] = [];

    items.forEach(item => {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    });

    if (files.length > 0) {
      e.preventDefault();
      validateAndAddFiles(files);
    }
  };

  // Handle drag events
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      validateAndAddFiles(files);
    }
  };
  
  const triggerFileInput = (ref: React.RefObject<HTMLInputElement | null>) => {
    if (ref.current) {
      ref.current.click();
    }
    setIsMenuOpen(false);
  };

  const removeFile = (fileToRemove: File) => {
    setSelectedFiles(prev => prev.filter(file => file !== fileToRemove));
  };

  const handleSend = async () => {
    if (!hasContent || isGenerating) return;

    const messageMetadata: Record<string, any> = { isThinkingEnabled: isThinkingVisible };

    try {
      const uploadPromises = selectedFiles.map(file => uploadFile(file));
      const uploadResults = await Promise.all(uploadPromises);
      const newAttachments: Attachment[] = uploadResults.map(result => result.file);
      onSendMessage(text, newAttachments, messageMetadata);
      setText('');
      setSelectedFiles([]);
    } catch (error) {
      showNotification((error as Error).message || 'An error occurred during upload.', 'error');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const hiddenDiv = document.createElement('div');
    hiddenDiv.style.position = 'absolute';
    hiddenDiv.style.visibility = 'hidden';
    hiddenDiv.style.height = 'auto';
    hiddenDiv.style.width = `${textarea.clientWidth}px`;
    hiddenDiv.style.fontSize = window.getComputedStyle(textarea).fontSize;
    hiddenDiv.style.fontFamily = window.getComputedStyle(textarea).fontFamily;
    hiddenDiv.style.lineHeight = window.getComputedStyle(textarea).lineHeight;
    hiddenDiv.style.padding = '0';
    hiddenDiv.style.border = 'none';
    hiddenDiv.style.wordWrap = 'break-word';
    hiddenDiv.style.whiteSpace = 'pre-wrap';
    hiddenDiv.textContent = text || '\u200B';
    document.body.appendChild(hiddenDiv);
    const contentHeight = hiddenDiv.scrollHeight;
    document.body.removeChild(hiddenDiv);
    const baseHeight = 24;
    const maxHeight = 120;
    if (contentHeight <= baseHeight) {
      textarea.style.height = `${baseHeight}px`;
      textarea.classList.remove('scrollable');
    } else if (contentHeight <= maxHeight) {
      textarea.style.height = `${contentHeight}px`;
      textarea.classList.remove('scrollable');
    } else {
      textarea.style.height = `${maxHeight}px`;
      textarea.classList.add('scrollable');
    }
  };

  const handleInput = () => { adjustTextareaHeight(); };
  useEffect(() => { adjustTextareaHeight(); }, [text]);
  useEffect(() => {
    if (!text && textareaRef.current) {
      textareaRef.current.style.height = '24px';
      textareaRef.current.classList.remove('scrollable');
    }
  }, [text]);

  return (
    <div 
      className={`chat-input-container ${isDragging ? 'drag-active' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isProUser && (
        <VoiceChatModal 
          isOpen={isVoiceChatOpen} 
          onClose={() => setIsVoiceChatOpen(false)} 
        />
      )}
      
      {selectedFiles.length > 0 && (
        <div className="attachment-preview-area">
          {selectedFiles.map((file, index) => (
            // --- OPTIMIZATION: Use sub-component for resizing ---
            <AttachmentPreviewItem 
                key={`${file.name}-${index}`} 
                file={file} 
                onRemove={removeFile} 
            />
          ))}
        </div>
      )}

      <div className="chat-input-wrapper">
        <input type="file" ref={imageInputRef} onChange={handleFileSelect} multiple accept="image/*" style={{ display: 'none' }} />
        <input type="file" ref={fileInputRef} onChange={handleFileSelect} multiple style={{ display: 'none' }} />

        <Tooltip text={isThinkingEnabled ? "Disable reasoning" : "Enable reasoning"}>
          <button
            className={`chat-input-button reasoning-button ${isThinkingEnabled ? 'active' : ''}`}
            onClick={toggleThinking}
          >
            <ThinkingIcon className="reasoning-icon" />
          </button>
        </Tooltip>

        <div className="chat-input-divider" />
        
        <button
          ref={plusButtonRef}
          className="chat-input-button"
          onClick={() => setIsMenuOpen(prev => !prev)}
        >
          <FiPlus size={20} />
        </button>
        
        {isMenuOpen && (
          <div ref={menuRef} className="context-menu">
            <button className="context-menu-button" onClick={() => triggerFileInput(imageInputRef)}>
              <FiImage size={20} className="menu-button-icon" />
              <span>Attach Image</span>
            </button>
            <button className="context-menu-button" onClick={() => triggerFileInput(fileInputRef)}>
              <FiPaperclip size={20} className="menu-button-icon" />
              <span>Attach File</span>
            </button>
          </div>
        )}
        
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder="Message Lyseris"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onPaste={handlePaste}
          rows={1}
        />
        <div className="chat-input-actions">
          {isGenerating ? (
            <Tooltip text="Stop generating">
              <button
                className="chat-input-button stop-button"
                onClick={onStopGeneration}
              >
                <FiSquare size={18} />
              </button>
            </Tooltip>
          ) : (
            <>
              {!hasContent && (
                <Tooltip text={voiceTooltip}>
                  <button 
                    className={`chat-input-button mic-button ${isProUser ? '' : 'mic-button-disabled'}`}
                    onClick={() => {
                      if (!isProUser) {
                        showNotification('Voice chat is available for Pro users only.', 'error');
                        return;
                      }
                      setIsVoiceChatOpen(true);
                    }}
                    aria-disabled={!isProUser}
                  >
                    <HiOutlineMicrophone size={20} />
                  </button>
                </Tooltip>
              )}
              <button
                className="chat-input-button send-button"
                onClick={handleSend}
                disabled={!hasContent || isGenerating}
              >
                {isSending ? <div className="button-spinner"></div> : <FiSend size={20} />}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatInput;
