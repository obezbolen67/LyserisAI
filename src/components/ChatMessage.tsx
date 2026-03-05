// src/components/ChatMessage.tsx
import { useState, useEffect, memo, useMemo, useRef, useCallback } from 'react';
import type { Message, Attachment } from '../types';
import api from '../utils/api';
import '../css/ChatMessage.css';
import '../css/AnalysisBlock.css';
import '../css/SearchBlock.css';
import React from 'react';
import { FiCopy, FiRefreshCw, FiEdit, FiCheck, FiLoader, FiExternalLink, FiSearch } from 'react-icons/fi';
import ImageViewer from './ImageViewer';
import Tooltip from './Tooltip';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import CodeAnalysisBlock from './CodeAnalysisBlock';
import InlineThinking from './InlineThinking';
import { getFileIcon } from '../utils/fileIcons';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import AnalysisBlock from './AnalysisBlock';
import { useNotification } from '../contexts/NotificationContext';
import GeolocationBlock from './GeolocationBlock';
import GeolocationRequestBlock from './GeolocationRequestBlock';
import GoogleMapsBlock from './GoogleMapsBlock';
import StreamingText from './StreamingText';
import { useSidePanel } from '../contexts/SidePanelContext';

interface CodeComponentProps {
  node?: any;
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  [key: string]: any;
}

// --- HELPER: Client-side Image Resizing ---
const generateThumbnailFromBlob = async (blob: Blob): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        const maxWidth = 300;
        const scale = maxWidth / img.width;
        if (scale >= 1) { resolve(url); return; }
        const canvas = document.createElement('canvas');
        canvas.width = maxWidth;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL(blob.type));
      };
      img.src = url;
    });
};

const useTheme = () => {
    const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || 'dark');
    useEffect(() => {
        const observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
                    setTheme(document.documentElement.getAttribute('data-theme') || 'dark');
                    break;
                }
            }
        });
        observer.observe(document.documentElement, { attributes: true });
        return () => observer.disconnect();
    }, []);
    return theme;
};

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch { }
  }
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed"; textArea.style.top = "-9999px";
  document.body.appendChild(textArea);
  textArea.focus(); textArea.select();
  try { return document.execCommand("copy"); } catch { return false; } finally { document.body.removeChild(textArea); }
}

const CustomCode = ({ node, inline, className, children, style, ...props }: CodeComponentProps) => {
  const [isCopied, setIsCopied] = useState(false);
  const theme = useTheme();
  const match = /language-(\w+)/.exec(className || '');
  const codeString = String(children).replace(/\n$/, '');
  const syntaxHighlighterStyle = theme === 'light' ? oneLight : vscDarkPlus;

  const handleCopy = async () => {
    if (await copyTextToClipboard(codeString)) {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  return !inline && match ? (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span className="language-name">{match[1]}</span>
        <button onClick={handleCopy} className="copy-code-button">
          {isCopied ? <FiCheck size={16} /> : <FiCopy size={16} />}
          <span>{isCopied ? 'Copied!' : 'Copy code'}</span>
        </button>
      </div>
      <SyntaxHighlighter style={syntaxHighlighterStyle} language={match[1]} PreTag="div" {...props}>{codeString}</SyntaxHighlighter>
    </div>
  ) : <code className={className} {...props}>{children}</code>;
};

const Paragraph: Components['p'] = ({ node, ...props }) => {
    const child = node?.children[0];
    const childClassName = (child?.type === 'element' && child.properties?.className?.toString()) || '';
    if (node?.children.length === 1 && child?.type === 'element' && (child?.tagName === 'pre' || childClassName.includes('tool-block-container') || childClassName.includes('inline-thinking-container') || childClassName.includes('markdown-image-wrapper') || childClassName.includes('geolocation-request-container') || childClassName.includes('search-indicator'))) {
        return <>{props.children}</>;
    }
    return <p {...props} />;
};

const MarkdownImageLink = memo(({ src, alt, onView }: { src: string; alt: string; onView: (src: string) => void }) => {
    const [isTall, setIsTall] = useState(false);

    const handleLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
        const renderedHeight = event.currentTarget.getBoundingClientRect().height;
        setIsTall(renderedHeight > 50);
    }, []);

    return (
        <a
            href={src}
            onClick={(e) => {
                e.preventDefault();
                onView(src);
            }}
            className={`markdown-image-wrapper ${isTall ? 'is-tall' : ''}`}
        >
            <img src={src} alt={alt} onLoad={handleLoad} />
        </a>
    );
});

// --- COMPONENT: Local Attachment (Optimistic) with Resizing ---
const LocalAttachmentImage = memo(({ src, fileName, onView }: { src: string, fileName: string, onView: (s: string) => void }) => {
    const [thumbSrc, setThumbSrc] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        fetch(src).then(r => r.blob()).then(blob => {
            return generateThumbnailFromBlob(blob);
        }).then(thumb => {
            if (active) setThumbSrc(thumb);
        }).catch(() => {
            if (active) setThumbSrc(src);
        });
        return () => { active = false; };
    }, [src]);

    if (!thumbSrc) return <div className="attachment-image-wrapper loading" />;

    return (
        <a href={src} onClick={(e) => { e.preventDefault(); onView(src); }} className="attachment-image-wrapper">
            <img src={thumbSrc} alt={fileName} />
        </a>
    );
});

// --- COMPONENT: Authenticated Image (Server) with Resizing ---
const AuthenticatedImage = memo(({ chatId, attachment, onView }: { chatId: string, attachment: Attachment, onView: (src: string) => void }) => {
    const [thumbUrl, setThumbUrl] = useState<string | null>(null);
    const [fullUrl, setFullUrl] = useState<string | null>(null);
    const [hasError, setHasError] = useState(false);
    const apiEndpoint = attachment._id ? `/files/view/${chatId}/${attachment._id}` : null;

    useEffect(() => {
        if (!apiEndpoint) { setThumbUrl(null); setFullUrl(null); setHasError(false); return; }
        let isMounted = true;
        setHasError(false); 
        
        api(apiEndpoint)
            .then(res => { if (!res.ok) throw new Error(`Server responded with ${res.status}`); return res.blob(); })
            .then(async (blob) => { 
                if (isMounted) { 
                    const full = URL.createObjectURL(blob);
                    setFullUrl(full);
                    const thumb = await generateThumbnailFromBlob(blob);
                    if (isMounted) setThumbUrl(thumb);
                }
            })
            .catch(() => { if (isMounted) setHasError(true); });
            
        return () => { 
            isMounted = false; 
            if (fullUrl) URL.revokeObjectURL(fullUrl); 
        };
    }, [apiEndpoint, attachment.fileName]);

    if (hasError) return <div className="attachment-image-wrapper error"><span>Error Loading Image</span></div>;
    if (!thumbUrl || !fullUrl) return <div className="attachment-image-wrapper loading" />;

    return (
        <a href={fullUrl} onClick={(e) => { e.preventDefault(); onView(fullUrl); }} className="attachment-image-wrapper">
            <img src={thumbUrl} alt={attachment.fileName} />
        </a>
    );
});

// Reusable styles for the link button
const linkButtonStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: '4px',
    padding: '4px',
    borderRadius: '6px',
    backgroundColor: 'var(--bg-secondary, rgba(128, 128, 128, 0.1))',
    border: '1px solid var(--border-color, rgba(128, 128, 128, 0.2))',
    color: 'var(--text-primary, inherit)',
    verticalAlign: 'middle',
    lineHeight: 0,
    cursor: 'pointer',
    transition: 'background-color 0.2s',
    fontSize: '0.8em',
    textDecoration: 'none'
};

// --- Helper Functions for Search Result Parsing ---
const parseSearchMarkdown = (content: string) => {
  if (!content) return [];
  const sources = [];
  const regex = /\*\*(.*?)\*\*\n\*Source: (.*?)\*\n\n> (.*?)(?=\n\n---|\n*$)/gs;
  let match;
  while ((match = regex.exec(content)) !== null) {
    sources.push({
      title: match[1].trim(),
      url: match[2].trim(),
      snippet: match[3].trim()
    });
  }
  return sources;
};

const cleanSearchQuery = (rawContent: string) => {
    if (!rawContent) return '';
    try {
        const parsed = JSON.parse(rawContent);
        if (parsed.query) return parsed.query;
    } catch (e) {
        return rawContent.replace(/^"|"$/g, '');
    }
    return rawContent;
};

const isAbsoluteLikeUrl = (value: string) => /^(https?:)?\/\//i.test(value) || value.startsWith('data:') || value.startsWith('blob:');

const normalizeAssetCandidate = (value: string) =>
    decodeURIComponent(String(value || '').trim())
        .replace(/[?#].*$/, '')
        .replace(/^<|>$/g, '')
        .replace(/^"|"$/g, '')
        .replace(/^\.\//, '')
        .replace(/^\//, '');

type AssistantTurnProps = { 
  messages: Message[];
  chatId: string | null;
  startIndex: number;
  isStreaming: boolean;
  isThinking: boolean;
  onRegenerate: () => void;
  onCopy: (content: string) => void;
  onView: (src: string) => void; 
};

const AssistantTurn = memo(({ messages, chatId, startIndex, isStreaming, isThinking, onRegenerate, onCopy, onView }: AssistantTurnProps) => {
    const { openPanel } = useSidePanel();

    const registerFileOutputCandidate = (map: Map<string, string>, candidate: string | undefined, url: string | undefined) => {
        if (!candidate || !url) return;
        const normalized = normalizeAssetCandidate(candidate);
        if (!normalized) return;
        map.set(normalized, url);
        const tail = normalized.split('/').pop();
        if (tail) map.set(tail, url);
    };

    const fileOutputUrlsByName = useMemo(() => {
        const map = new Map<string, string>();

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];

            if (!msg.fileOutputs?.length) continue;

            for (const output of msg.fileOutputs) {
                if (!output?.url) continue;
                registerFileOutputCandidate(map, output.fileName, output.url);
                registerFileOutputCandidate(map, output.gcsObjectName, output.url);
            }
        }

        return map;
    }, [messages]);

    const resolveTurnFileOutputUrl = useCallback((value: string): string => {
        if (!value) return value;
        if (isAbsoluteLikeUrl(value)) return value;

        const normalized = normalizeAssetCandidate(value);
        return fileOutputUrlsByName.get(normalized) || fileOutputUrlsByName.get(value) || value;
    }, [fileOutputUrlsByName]);
    
    const ImageRenderer: Components['img'] = ({ src, alt }) => {
        if (!src) return null;
        const resolvedSrc = resolveTurnFileOutputUrl(src);
        return (
            <MarkdownImageLink
                src={resolvedSrc}
                alt={alt || 'image from message'}
                onView={onView}
            />
        );
    };

    const LinkRenderer: Components['a'] = ({ href, children }) => {
        if (!href) return <>{children}</>;
        const resolvedHref = resolveTurnFileOutputUrl(href);
        
        // Handle Images
        const isImage = resolvedHref.match(/\.(jpeg|jpg|gif|png|bmp|webp)($|\?)/i);
        if (isImage) {
            return (
                <MarkdownImageLink
                    src={resolvedHref}
                    alt={String(children) || 'generated image'}
                    onView={onView}
                />
            );
        }

        // Handle Text Links
        const linkText = String(children);
        const isRawUrl = linkText.startsWith('http') || linkText.startsWith('www.') || linkText.length > 30;

        // If it's a raw long URL, replace text with just the button
        if (isRawUrl) {
            return (
                <Tooltip text={href}>
                    <a 
                        href={resolvedHref} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="chat-link-icon-only"
                        aria-label="Open Link"
                    >
                        <FiExternalLink size={16} />
                    </a>
                </Tooltip>
            );
        }

        // For named links like [Click Here](url), keep text + small icon
        return (
            <span className="link-container">
                <a href={resolvedHref} target="_blank" rel="noopener noreferrer" className="chat-link-text">
                    {children}
                </a>
                <Tooltip text={resolvedHref}>
                    <a href={resolvedHref} target="_blank" rel="noopener noreferrer" style={linkButtonStyle} className="chat-link-button">
                        <FiExternalLink size={12} />
                    </a>
                </Tooltip>
            </span>
        );
    };
    
    const { turnParts, fullContent, lastMessageInTurnIndex, accumulatedSources } = useMemo(() => {
        const parts: React.ReactNode[] = [];
        const textParts: string[] = [];
        let lastIndex = startIndex;
        const processedToolIds = new Set<string>();
        let currentTextBuffer = '';
        const sources: any[] = [];

        const flushTextBuffer = (key: string) => {
            if (currentTextBuffer.trim()) {
                const isLastGlobalMessage = lastIndex === messages.length - 1;
                const isCurrentlyStreaming = isStreaming && isLastGlobalMessage && key.includes('final');
                
                parts.push(
                    <StreamingText
                        key={key}
                        content={currentTextBuffer}
                        isStreaming={isCurrentlyStreaming}
                        components={{ code: CustomCode, p: Paragraph, img: ImageRenderer, a: LinkRenderer }}
                    />
                );
            }
            currentTextBuffer = '';
        };

        for (let i = startIndex; i < messages.length; i++) {
            const currentMessage = messages[i];
            if (currentMessage.role === 'user') { lastIndex = i - 1; break; }

            if (currentMessage.role === 'assistant') {
                if (currentMessage.thinking) {
                    flushTextBuffer(`text-before-thinking-${i}`);
                    parts.push(<InlineThinking key={`thinking-${i}`} content={currentMessage.thinking} isStreaming={isThinking && i === messages.length - 1} />);
                }
                if (currentMessage.content) {
                    currentTextBuffer += currentMessage.content;
                    textParts.push(currentMessage.content);
                }
            } else if (currentMessage.tool_id && !processedToolIds.has(currentMessage.tool_id)) {
                const toolType = currentMessage.role;
                const resultRole = toolType + '_result' as Message['role'];
                const outputMessage = messages.find(m => m.role === resultRole && m.tool_id === currentMessage.tool_id);
                const state = currentMessage.state || (outputMessage ? 'completed' : 'writing');

                if (toolType === 'tool_code') {
                    flushTextBuffer(`text-before-code-${i}`);
                    parts.push(<CodeAnalysisBlock key={`code-${currentMessage.tool_id}`} chatId={chatId} toolCodeMessage={currentMessage} toolOutputMessage={outputMessage} onView={onView} />);
                } else if (toolType === 'tool_search') {
                    const queryText = cleanSearchQuery(currentMessage.content || '');
                    
                    flushTextBuffer(`text-before-search-${i}`);
                    parts.push(
                        <div key={`search-indicator-${currentMessage.tool_id}`} className="search-indicator">
                            <div className="search-icon-wrapper"><FiSearch size={14} /></div>
                            <span className="search-text">
                                {state === 'writing' || state === 'searching' ? 'Searching for ' : 'Searched for '} 
                                "{queryText}"
                            </span>
                        </div>
                    );

                    if (outputMessage && !outputMessage.content?.includes('[LOCATION]')) {
                        const newSources = parseSearchMarkdown(outputMessage.content || '');
                        if(newSources.length > 0) sources.push(...newSources);
                    } else if (outputMessage && outputMessage.content?.includes('[LOCATION]')) {
                        flushTextBuffer(`text-before-geo-${i}`);
                        parts.push(<GeolocationBlock key={`geo-${currentMessage.tool_id}`} toolMessage={currentMessage} outputMessage={outputMessage} />);
                    }
                } else if (toolType === 'tool_doc_extract') {
                    flushTextBuffer(`text-before-extract-${i}`);
                    parts.push(<AnalysisBlock key={`extract-${currentMessage.tool_id}`} toolMessage={currentMessage} outputMessage={outputMessage} />);
                } else if (toolType === 'tool_geolocation') {
                    flushTextBuffer(`text-before-geo-req-${i}`);
                    const hasResult = messages.some(m => m.role === 'tool_geolocation_result' && m.tool_id === currentMessage.tool_id);
                    if (!hasResult) {
                        parts.push(<GeolocationRequestBlock key={`geo-req-${currentMessage.tool_id}`} toolMessage={currentMessage} />);
                    }
                } else if (
                    toolType === 'tool_integration' ||
                    toolType === 'tool_integration_result' ||
                    toolType === 'tool_guide' ||
                    toolType === 'tool_guide_result'
                ) {
                    flushTextBuffer(`text-before-int-${i}`);
                    const data = outputMessage?.integrationData || (currentMessage.role === 'tool_integration_result' ? currentMessage.integrationData : null);
                    if (data?.type === 'google_maps_route') {
                        parts.push(<GoogleMapsBlock key={`maps-${currentMessage.tool_id}`} integrationData={data} />);
                    } else {
                        const textOutput = outputMessage?.content || ((currentMessage.role === 'tool_integration_result' || currentMessage.role === 'tool_guide_result') ? currentMessage.content : null);
                        if (textOutput && textOutput.trim()) {
                            parts.push(
                                <StreamingText
                                    key={`integration-text-${currentMessage.tool_id}-${i}`}
                                    content={textOutput}
                                    isStreaming={false}
                                    components={{ code: CustomCode, p: Paragraph, img: ImageRenderer, a: LinkRenderer }}
                                />
                            );
                            textParts.push(textOutput);
                        }
                    }
                }
                processedToolIds.add(currentMessage.tool_id);
            }
            lastIndex = i;
        }
        flushTextBuffer('text-final');
        
        return { turnParts: parts, fullContent: textParts.join('\n\n'), lastMessageInTurnIndex: lastIndex, accumulatedSources: sources };
    }, [messages, chatId, startIndex, isStreaming, onView, isThinking]);

    const isStreamingInThisTurn = isStreaming && (messages.length - 1 <= lastMessageInTurnIndex);
    const showSources = accumulatedSources.length > 0 && !isStreamingInThisTurn;

    return (
        <div className={`chat-message-wrapper assistant ${isStreamingInThisTurn ? 'is-streaming' : ''}`}>
            <div className="chat-message-container">
                <div className="message-content-wrapper">
                    <div className={`message-content ${isStreamingInThisTurn ? 'is-streaming' : 'streaming-complete'}`}>
                        {turnParts}
                        
                        {/* Show 3 dots if streaming but no content yet */}
                        {isStreamingInThisTurn && turnParts.length === 0 && (
                            <div className="typing-indicator">
                                <span></span><span></span><span></span>
                            </div>
                        )}
                        
                        {/* Show cursor if content exists and still streaming */}
                        {isStreamingInThisTurn && turnParts.length > 0 && <span className="streaming-cursor"></span>}
                    </div>
                    
                    {/* FOOTER ACTIONS ROW */}
                    {!isStreamingInThisTurn && (fullContent || showSources) && (
                        <div className="message-actions">
                            {/* Standard Actions First */}
                            <div className="action-buttons-group" style={{ display: 'flex', gap: '0.5rem' }}>
                                <Tooltip text="Regenerate"><button className="action-button" onClick={onRegenerate}><FiRefreshCw size={16} /></button></Tooltip>
                                <Tooltip text="Copy"><button className="action-button" onClick={() => onCopy(fullContent)}><FiCopy size={16} /></button></Tooltip>
                            </div>

                            {showSources && (
                                <button className="sources-trigger" onClick={() => openPanel('sources', { sources: accumulatedSources })}>
                                    {accumulatedSources.slice(0, 3).map((s: any, i: number) => (
                                        <img 
                                            key={i} 
                                            className="source-favicon-stack"
                                            src={`https://www.google.com/s2/favicons?domain=${new URL(s.url).hostname}&sz=32`} 
                                            alt=""
                                            onError={(e) => (e.target as HTMLImageElement).style.display = 'none'}
                                        />
                                    ))}
                                    <span className="sources-count">{accumulatedSources.length} Sources</span>
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});


interface ChatMessageProps {
  message: Message;
  messages: Message[];
  chatId: string | null;
  index: number;
  isEditing: boolean;
  isStreaming: boolean;
  isThinking: boolean;
  onRegenerate: () => void;
  onCopy: (content: string) => void;
  onStartEdit: (index: number) => void;
  onSaveEdit: (index: number, newContent: string, metadata?: Record<string, any>) => void;
  onCancelEdit: () => void;
}

const ChatMessage = ({ message, messages, chatId, index, isEditing, isStreaming, isThinking, onStartEdit, onSaveEdit, onCancelEdit, ...rest }: ChatMessageProps) => {
  const { showNotification } = useNotification();
  const [editedContent, setEditedContent] = useState(message.content || '');
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const editTextAreaRef = useRef<HTMLTextAreaElement>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleDownloadAttachment = async (e: React.MouseEvent<HTMLAnchorElement>, attachment: Attachment) => {
    e.preventDefault();
    if (downloadingId) return; 

    if (!chatId || !attachment._id) {
      showNotification('Cannot download file: Missing identifiers.', 'error');
      return;
    }

    setDownloadingId(attachment._id); 

    try {
      const response = await api(`/files/view/${chatId}/${attachment._id}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ msg: 'Download failed' }));
        throw new Error(errorData.msg || `Server responded with ${response.status}`);
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', attachment.fileName);
      
      document.body.appendChild(link);
      link.click();
      
      link.parentNode?.removeChild(link);
      window.URL.revokeObjectURL(url);

    } catch (error) {
      showNotification(error instanceof Error ? error.message : 'Could not download file.', 'error');
    } finally {
      setDownloadingId(null); 
    }
  };

  useEffect(() => {
    if (isEditing) setEditedContent(message.content || '');
  }, [isEditing, message.content]);

  useEffect(() => {
    if (isEditing && editTextAreaRef.current) {
      const ta = editTextAreaRef.current;
      ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
      setTimeout(() => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 400)}px`; }, 0);
    }
  }, [isEditing]);

  const handleOpenViewer = useCallback((src: string) => { setViewerSrc(src); setIsViewerOpen(true); }, []);

  const renderAttachments = (attachments: Attachment[]) => (
    <div className="message-attachments">
        {attachments.map((att, idx) => {
            const isImage = att.mimeType.startsWith('image/');
            const url = (att as any).url || `/api/files/view/${chatId}/${att._id}`;
            if(isImage) {
                 if((att as any).url) return <LocalAttachmentImage key={idx} src={url} fileName={att.fileName} onView={handleOpenViewer} />;
                 return <AuthenticatedImage key={idx} chatId={chatId!} attachment={att} onView={handleOpenViewer} />;
            }
            return (
                <a key={idx} href={url} onClick={(e) => { if(!Boolean(chatId && att._id)) { e.preventDefault(); return; } handleDownloadAttachment(e, att); }} className={`attachment-file-link ${downloadingId === att._id ? 'downloading' : ''}`}>
                    <span className="attachment-file-icon">{downloadingId === att._id ? <FiLoader className="spinner-icon" /> : getFileIcon(att.mimeType)}</span>
                    <span className="attachment-file-name">{downloadingId === att._id ? 'Downloading...' : att.fileName}</span>
                </a>
            );
        })}
    </div>
  );

  if (message.role === 'user') {
    return (
        <div className={`chat-message-wrapper user ${isEditing ? 'editing' : ''}`}>
          <div className="chat-message-container">
            
            {/* --- Attachments displayed OUTSIDE and ABOVE the text bubble for User --- */}
            {!isEditing && message.attachments && message.attachments.length > 0 && (
                <div className="message-attachments-outside">
                    {renderAttachments(message.attachments)}
                </div>
            )}

            {(message.content || isEditing) && (
              <div className="user-message-bubble">
                {!isEditing ? (
                  <div className="message-content">
                    {/* Note: Attachments are now rendered above, not inside */}
                    {message.content && <ReactMarkdown remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]} rehypePlugins={[rehypeKatex]} components={{ code: CustomCode, p: Paragraph }}>{message.content}</ReactMarkdown>}
                  </div>
                ) : (
                  <div className="message-editor-content">
                      <textarea ref={editTextAreaRef} value={editedContent} onChange={(e) => setEditedContent(e.target.value)} rows={1} />
                      <div className="editor-actions">
                          <button className="editor-button cancel" onClick={onCancelEdit}>Cancel</button>
                          <button className="editor-button save" onClick={() => onSaveEdit(index, editedContent)}>Save</button>
                      </div>
                  </div>
                )}
              </div>
            )}
            {!isEditing && <div className="message-actions"><Tooltip text="Edit"><button className="action-button" onClick={() => onStartEdit(index)}><FiEdit size={16} /></button></Tooltip></div>}
          </div>
        </div>
    );
  }

  const isStartOfTurn = index === 0 || messages[index - 1]?.role === 'user';
  if (isStartOfTurn) {
    return (
      <>
        <AssistantTurn chatId={chatId} messages={messages} startIndex={index} isStreaming={isStreaming} isThinking={isThinking} {...rest} onView={handleOpenViewer} />
        <ImageViewer isOpen={isViewerOpen} src={viewerSrc} alt={viewerSrc || ''} onClose={() => setIsViewerOpen(false)} />
      </>
    );
  }
  return null;
};

export default memo(ChatMessage);