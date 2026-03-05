// src/contexts/ChatContext.tsx
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
  useRef,
} from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type { Message, Attachment } from '../types';
import { useSettings } from './SettingsContext';
import { useNotification } from './NotificationContext';
import api from '../utils/api';
import { fetchPublicConfig } from '../utils/config';
import { scheduleClientNotification } from '../utils/scheduler';

type ChatListItem = {
  _id: string;
  title: string;
  updatedAt: string;
};

interface ChatContextType {
  messages: Message[];
  chatList: ChatListItem[];
  activeChatId: string | null;
  loadChat: (chatId: string) => void;
  clearChat: () => void;
  isLoadingChat: boolean;
  isLoadingChatList: boolean;
  isCreatingChat: boolean;
  isSending: boolean;
  sendMessage: (
    text: string,
    attachments: Attachment[],
    metadata?: Record<string, any>
  ) => Promise<void>;
  stopGeneration: () => void;
  isStreaming: boolean;
  isThinking: boolean;
  isThinkingEnabled: boolean;
  toggleThinking: () => void;
  thinkingContent: string | null;
  editingIndex: number | null;
  startEditing: (index: number) => void;
  cancelEditing: () => void;
  saveAndSubmitEdit: (
    index: number,
    newContent: string,
    metadata?: Record<string, any>
  ) => Promise<void>;
  regenerateResponse: (metadata?: Record<string, any>) => Promise<void>;
  renameChat: (chatId: string, newTitle: string) => Promise<void>;
  deleteChat: (chatId: string) => Promise<void>;
  clearAllChats: () => Promise<void>;
  sendGeolocationResult: (
    chatId: string,
    tool_id: string,
    result:
      | { coordinates: { latitude: number; longitude: number } }
      | { error: string }
  ) => Promise<void>;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const ChatProvider = ({ children }: { children: ReactNode }) => {
  const navigate = useNavigate();
  const { token, selectedModel, user } = useSettings();
  const { showNotification } = useNotification();

  const [messages, setMessages] = useState<Message[]>([]);
  const [chatList, setChatList] = useState<ChatListItem[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [isLoadingChat, setIsLoadingChat] = useState(false);
  const [isLoadingChatList, setIsLoadingChatList] = useState(true);
  const [isCreatingChat, setIsCreatingChat] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingContent, setThinkingContent] = useState<string | null>(null);
  const [isThinkingEnabled, setThinkingEnabled] = useState(false);
  const [reasoningModels, setReasoningModels] = useState<string[]>([]);

  const streamAbortControllerRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const toggleThinking = () => setThinkingEnabled((prev) => !prev);

  const getLocalTime = () => {
    const now = new Date();
    const padding = (num: number) => String(num).padStart(2, '0');
    const offset = -now.getTimezoneOffset() / 60;
    const sign = offset >= 0 ? '+' : '-';
    return `UTC${sign}${Math.abs(offset)} ${now.getFullYear()}-${padding(now.getMonth()+1)}-${padding(now.getDate())}T${padding(now.getHours())}:${padding(now.getMinutes())}`;
  };

  useEffect(() => {
    const fetchReasoningModels = async () => {
      try {
        const response = await fetchPublicConfig();
        if (response && (response as any).reasoningModels) {
           setReasoningModels((response as any).reasoningModels);
        }
      } catch (error) {
        // Fallback defaults
        setReasoningModels([
          'thinking', 'reasoning', 'o1', 'o3', 'deepseek-reasoner',
          'qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-vl-plus', 'qwen-vl-max',
          'qwen2.5', 'qwen-qwq', 'claude-3-7-sonnet', 'gemini-2.5'
        ]);
      }
    };
    fetchReasoningModels();
  }, []);

  useEffect(() => {
    const modelName = selectedModel?.toLowerCase() || '';
    const provider = user?.selectedProvider?.toLowerCase() || '';
    const isReasoningModel = 
      provider === 'default' || 
      reasoningModels.some(pattern => modelName.includes(pattern.toLowerCase()));
    setThinkingEnabled(isReasoningModel);
  }, [selectedModel, user?.selectedProvider, reasoningModels]);

  const loadChatList = useCallback(async () => {
    if (!token) {
      setIsLoadingChatList(false);
      return;
    }
    setIsLoadingChatList(true);
    try {
      const response = await api('/chats');
      if (!response.ok) throw new Error('Failed to fetch chat list');
      const data = await response.json();
      setChatList(data);
    } catch (error) {
      showNotification('Could not load chat history.', 'error');
    } finally {
      setIsLoadingChatList(false);
    }
  }, [token, showNotification]);

  useEffect(() => {
    loadChatList();
  }, [loadChatList]);

  const stopGeneration = useCallback(() => {
    if (streamAbortControllerRef.current) {
      streamAbortControllerRef.current.abort();
    }
    setIsStreaming(false);
    setIsThinking(false);
    setThinkingContent(null);
    setMessages((prev) => prev.filter((m) => !m.isWaiting));
    setIsSending(false);
    streamAbortControllerRef.current = null;
  }, []);

  const streamAndSaveResponse = useCallback(
    async (
      chatId: string,
      messageHistory: Message[],
      metadata?: Record<string, any>
    ) => {
      setIsSending(true);
      setIsStreaming(true);
      setIsThinking(false);
      setThinkingContent(null);

      streamAbortControllerRef.current = new AbortController();
      let currentAssistantThinking = '';
      let assistantMessageIndex = -1;
      let streamEndedForClientTool = false;

      const executeClientSchedule = async (tool_id: string, tool_name: string, args: any) => {
        const { task, description, datetime_from } = args;
        const scheduleDate = new Date(datetime_from);

        const result = await scheduleClientNotification(task, description, scheduleDate);

        let resultContent = '';
        let state: Message['state'] = 'completed';

        if (result.success) {
          const localTimeStr = scheduleDate.toLocaleString();
          resultContent = `Successfully scheduled notification for "${task}" at ${localTimeStr}.`;
        } else {
          state = 'error';
          resultContent = `Error: ${result.error}`;
          if (result.error?.includes('Permission needed')) {
             resultContent += " [SYSTEM NOTE: Please tell the user to click the 'Notifications' bell icon in the sidebar to enable permissions first.]";
          }
        }

        const resultMessage: Message = {
          role: 'tool_integration_result', 
          tool_id,
          tool_name,
          content: resultContent,
        };

        const currentHistory = messagesRef.current.filter(m => !m.isWaiting);
        const messagesForUI = currentHistory.map((m) =>
          m.tool_id === tool_id && m.role === 'tool_integration'
            ? ({ ...m, state } as Message)
            : m
        );
        const historyForBackend = [...messagesForUI, resultMessage];
        setMessages([...messagesForUI, { role: 'assistant', content: '', isWaiting: true }]);
        await streamAndSaveResponse(chatId, historyForBackend, { isContinuation: true });
      };

      try {
        let finMetadata = {...(metadata || {}), client_time: getLocalTime()};

        const response = await api(`/chats/${chatId}/stream`, {
          method: 'POST',
          body: JSON.stringify({ messagesFromClient: messageHistory, finMetadata }),
          signal: streamAbortControllerRef.current.signal,
        });

        if (!response.ok) {
          const errorData = await response
            .json()
            .catch(() => ({ error: 'Streaming failed with status ' + response.status }));
          throw new Error(errorData.error);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) throw new Error('Failed to read stream.');

        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf('\n\n');

          while (boundary !== -1) {
            const messageChunk = buffer.substring(0, boundary);
            buffer = buffer.substring(boundary + 2);
            const lines = messageChunk.split('\n');

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const jsonString = line.substring(6).trim();
              if (jsonString === '{"type":"done"}' || !jsonString) continue;

              try {
                const event = JSON.parse(jsonString);

                if (event.type === 'error') {
                  throw new Error(event.error?.message || 'An error occurred on the server.');
                }

                if (event.type === 'STREAM_END' && event.reason === 'tool_use') {
                  streamEndedForClientTool = true;
                  continue;
                }

                switch (event.type) {
                  case 'TOOL_CODE_CREATE':
                  case 'TOOL_SEARCH_CREATE':
                  case 'TOOL_DOC_EXTRACT_CREATE':
                  case 'TOOL_GEOLOCATION_CREATE':
                  case 'TOOL_GUIDE_CREATE':
                  case 'TOOL_INTEGRATION_CREATE':
                  case 'TOOL_SCHEDULE_CREATE':
                    if (event.message && event.message.isClientSideTool) {
                        streamEndedForClientTool = true;
                    }
                    
                    flushSync(() => {
                      setMessages((prev) => {
                        const newMessages = [...prev];
                        
                        const existingIndex = newMessages.findIndex(m => m.tool_id === event.message.tool_id);
                        
                        if (existingIndex !== -1) {
                            newMessages[existingIndex] = event.message;
                        } else {
                            const lastMessage = newMessages[newMessages.length - 1];
                            if (lastMessage?.isWaiting) {
                              newMessages[newMessages.length - 1] = event.message;
                            } else {
                              newMessages.push(event.message);
                            }
                        }
                        return newMessages;
                      });
                    });

                    if (event.type === 'TOOL_SCHEDULE_CREATE' && event.message.tool_arguments) {
                        executeClientSchedule(
                            event.message.tool_id,
                            event.message.tool_name,
                            event.message.tool_arguments
                        );
                    }
                    break;

                  case 'THINKING_START':
                    setIsThinking(true);
                    setThinkingContent('');
                    currentAssistantThinking = '';
                    setMessages((prev) => {
                      const newMessages = [...prev];
                      const lastMessage = newMessages[newMessages.length - 1];
                      if (lastMessage?.isWaiting) {
                        assistantMessageIndex = newMessages.length - 1;
                        newMessages[assistantMessageIndex] = { role: 'assistant', content: '', thinking: '' };
                      } else {
                        assistantMessageIndex = newMessages.length;
                        newMessages.push({ role: 'assistant', content: '', thinking: '' });
                      }
                      return newMessages;
                    });
                    break;

                  case 'THINKING_DELTA':
                    currentAssistantThinking += event.content;
                    setThinkingContent((prev) => (prev || '') + event.content);
                    flushSync(() => {
                      setMessages((prev) => {
                        const newMessages = [...prev];
                        if (assistantMessageIndex === -1 || assistantMessageIndex >= newMessages.length) {
                             const lastIdx = newMessages.length - 1;
                             if (newMessages[lastIdx]?.role === 'assistant') assistantMessageIndex = lastIdx;
                             else {
                                 assistantMessageIndex = newMessages.length;
                                 newMessages.push({ role: 'assistant', content: '', thinking: '' });
                             }
                        }
                        if (newMessages[assistantMessageIndex]) {
                            newMessages[assistantMessageIndex] = {
                                ...newMessages[assistantMessageIndex],
                                thinking: currentAssistantThinking,
                            };
                        }
                        return newMessages;
                      });
                    });
                    break;

                  case 'THINKING_END':
                    setIsThinking(false);
                    break;

                  case 'ASSISTANT_START':
                    setMessages((prev) => {
                      const newMessages = [...prev];
                      const lastMessage = newMessages[newMessages.length - 1];
                      if (lastMessage?.isWaiting) {
                        assistantMessageIndex = newMessages.length - 1;
                        newMessages[assistantMessageIndex] = {
                          role: 'assistant',
                          content: '',
                          thinking: currentAssistantThinking || undefined,
                        };
                      } else if (assistantMessageIndex === -1 || lastMessage.role !== 'assistant') {
                        assistantMessageIndex = newMessages.length;
                        newMessages.push({
                          role: 'assistant',
                          content: '',
                          thinking: currentAssistantThinking || undefined,
                        });
                      }
                      return newMessages;
                    });
                    break;

                  case 'ASSISTANT_DELTA':
                    flushSync(() => {
                      setMessages((prev) => {
                        const newMessages = [...prev];
                        if (assistantMessageIndex === -1 || assistantMessageIndex >= newMessages.length) {
                          assistantMessageIndex = newMessages.length;
                          newMessages.push({ role: 'assistant', content: '', thinking: currentAssistantThinking });
                        }
                        const currentMsg = newMessages[assistantMessageIndex];
                        newMessages[assistantMessageIndex] = {
                          ...currentMsg,
                          content: (currentMsg.content || '') + event.content,
                          thinking: currentAssistantThinking || currentMsg.thinking,
                        };
                        return newMessages;
                      });
                    });
                    break;

                  case 'USER_MESSAGE_ACK':
                    setMessages((prev) => {
                      const newMessages = [...prev];
                      const lastUserMessageIndex = newMessages.findLastIndex((m) => m.role === 'user');
                      if (lastUserMessageIndex !== -1) {
                        newMessages[lastUserMessageIndex] = event.message;
                      }
                      return newMessages;
                    });
                    break;

                  case 'ASSISTANT_COMPLETE':
                    break;

                  case 'TOOL_CODE_DELTA':
                  case 'TOOL_SEARCH_DELTA':
                  case 'TOOL_DOC_EXTRACT_DELTA':
                  case 'TOOL_GEOLOCATION_DELTA':
                  case 'TOOL_GUIDE_DELTA':
                  case 'TOOL_INTEGRATION_DELTA':
                    flushSync(() => {
                      setMessages((prev) => {
                        const newMessages = [...prev];
                        const toolIndex = newMessages.findIndex((m) => m.tool_id === event.tool_id);
                        if (toolIndex !== -1) {
                          newMessages[toolIndex] = {
                            ...newMessages[toolIndex],
                            content: (newMessages[toolIndex].content || '') + event.content,
                          };
                        }
                        return newMessages;
                      });
                    });
                    break;

                  case 'TOOL_CODE_COMPLETE':
                  case 'TOOL_SEARCH_COMPLETE':
                  case 'TOOL_DOC_EXTRACT_COMPLETE':
                  case 'TOOL_GEOLOCATION_COMPLETE':
                  case 'TOOL_GUIDE_COMPLETE':
                  case 'TOOL_INTEGRATION_COMPLETE':
                    setMessages((prev) => {
                      const newMessages = [...prev];
                      const toolIndex = newMessages.findIndex((m) => m.tool_id === event.tool_id);
                      if (toolIndex !== -1) newMessages[toolIndex].state = 'ready_to_execute';
                      return newMessages;
                    });
                    break;

                  case 'TOOL_CODE_STATE_UPDATE':
                  case 'TOOL_SEARCH_STATE_UPDATE':
                  case 'TOOL_DOC_EXTRACT_STATE_UPDATE':
                  case 'TOOL_GEOLOCATION_STATE_UPDATE':
                  case 'TOOL_GUIDE_STATE_UPDATE':
                  case 'TOOL_INTEGRATION_STATE_UPDATE':
                    setMessages((prev) => {
                      const newMessages = [...prev];
                      const toolIndex = newMessages.findIndex((m) => m.tool_id === event.tool_id);
                      if (toolIndex !== -1) newMessages[toolIndex].state = event.state;
                      return newMessages;
                    });
                    break;

                  case 'TOOL_CODE_RESULT':
                  case 'TOOL_SEARCH_RESULT':
                  case 'TOOL_DOC_EXTRACT_RESULT':
                  case 'TOOL_GEOLOCATION_RESULT':
                  case 'TOOL_GUIDE_RESULT':
                  case 'TOOL_INTEGRATION_RESULT':
                    setMessages((prev) => {
                      const newMessages = [...prev];
                      const toolReqRole = event.type.replace('_RESULT', '').toLowerCase();
                      const toolIndex = newMessages.findIndex(
                        (m) => m.role === toolReqRole && m.tool_id === event.tool_id
                      );
                      if (toolIndex !== -1) newMessages[toolIndex].state = event.state;

                      const resultRole = (toolReqRole + '_result') as Message['role'];
                      newMessages.push({
                        role: resultRole,
                        content: event.result.content,
                        tool_id: event.tool_id,
                        fileOutputs: event.result.fileOutputs || undefined,
                        integrationData: event.result.integrationData || undefined,
                      });
                      return newMessages;
                    });
                    assistantMessageIndex = -1;
                    currentAssistantThinking = '';
                    break;
                }
              } catch (error) {
                throw error;
              }
            }

            boundary = buffer.indexOf('\n\n');
          }
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          // Handled via abort controller logic
        } else {
          showNotification(error instanceof Error ? error.message : 'Streaming error', 'error');
        }
      } finally {
        if (streamEndedForClientTool) {
          setIsStreaming(false);
          streamAbortControllerRef.current = null;
        } else {
          stopGeneration();
        }
      }
    },
    [stopGeneration, showNotification]
  );

  const sendMessage = async (text: string, attachments: Attachment[] = [], metadata?: Record<string, any>) => {
    if (isStreaming || isSending) return;
    const userMessage: Message = { role: 'user', content: text, attachments };
    const currentMessages = messagesRef.current;
    const originalMessages = currentMessages;

    try {
      if (!activeChatId) {
        setIsCreatingChat(true);
        const initialMessages = [userMessage];
        const createChatResponse = await api('/chats', {
          method: 'POST',
          body: JSON.stringify({ messages: initialMessages }),
        });
        if (!createChatResponse.ok) throw new Error('Failed to create chat.');
        const newChat = await createChatResponse.json();
        setActiveChatId(newChat._id);
        navigate(`/app/c/${newChat._id}`, { replace: true });

        const messagesWithPlaceholder = [...newChat.messages, { role: 'assistant', content: '', isWaiting: true } as Message];
        setMessages(messagesWithPlaceholder);
        
        await streamAndSaveResponse(newChat._id, newChat.messages, { ...metadata, client_time: getLocalTime(), isThinkingEnabled, userMessageAlreadySaved: true });
        await loadChatList();
      } else {
        const updatedMessages = [...currentMessages, userMessage];
        const messagesWithPlaceholder = [...updatedMessages, { role: 'assistant', content: '', isWaiting: true } as Message];
        setMessages(messagesWithPlaceholder);
        await streamAndSaveResponse(activeChatId, updatedMessages, { ...metadata, client_time: getLocalTime(), isThinkingEnabled });
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        showNotification(error instanceof Error ? error.message : 'Could not send message.', 'error');
      }
      if (activeChatId) setMessages(originalMessages);
      else { setMessages([]); setActiveChatId(null); navigate('/', { replace: true }); }
    } finally {
      setIsCreatingChat(false);
    }
  };

  const sendGeolocationResult = useCallback(async (chatId: string, tool_id: string, result: any) => {
      if (isStreaming) return;
      let result_content;
      if ('coordinates' in result) {
        result_content = `User's location is latitude ${result.coordinates.latitude.toFixed(6)}, longitude ${result.coordinates.longitude.toFixed(6)}.`;
      } else {
        result_content = `Could not get user's location. Error: ${result.error}`;
      }
      
      const currentMessages = messagesRef.current;
      const cleanMessages = currentMessages.filter((m) => !m.isWaiting);
      const originalToolMsg = cleanMessages.find(m => m.tool_id === tool_id && m.role === 'tool_geolocation');
      if (!originalToolMsg) return;

      const resultMessage: Message = {
        role: 'tool_geolocation_result',
        tool_id: tool_id,
        tool_name: originalToolMsg.tool_name,
        content: result_content,
      };

      const messagesForUI = cleanMessages.map((m) =>
        m.tool_id === tool_id ? ({ ...m, state: 'error' in result ? 'error' : 'completed' } as Message) : m
      );

      const historyForBackend = [...messagesForUI, resultMessage];
      setMessages([...messagesForUI, { role: 'assistant', content: '', isWaiting: true }]);
      await streamAndSaveResponse(chatId, historyForBackend, { isContinuation: true });
    },
    [isStreaming, streamAndSaveResponse]
  );

  const loadChat = useCallback(async (id: string) => {
      setIsLoadingChat(true);
      try {
        const response = await api(`/chats/${id}`);
        if (!response.ok) throw new Error('Chat not found');
        const data = await response.json();
        setMessages(data.messages);
        setActiveChatId(data._id);
      } catch (error) {
        navigate('/', { replace: true });
      } finally {
        setIsLoadingChat(false);
      }
    }, [navigate]);

  const clearChat = useCallback(() => { setMessages([]); setActiveChatId(null); setEditingIndex(null); }, []);
  const startEditing = (index: number) => setEditingIndex(index);
  const cancelEditing = () => setEditingIndex(null);

  const saveAndSubmitEdit = async (index: number, newContent: string) => {
    if (!activeChatId) return;
    stopGeneration();
    const historyUpToEdit = messagesRef.current.slice(0, index);
    const updatedUserMessage: Message = { ...messages[index], content: newContent };
    const newHistory = [...historyUpToEdit, updatedUserMessage];
    const messagesForUi = [...newHistory, { role: 'assistant', content: '', isWaiting: true } as Message];
    setMessages(messagesForUi);
    setEditingIndex(null);
    await streamAndSaveResponse(activeChatId, newHistory, { isRegeneration: true, isThinkingEnabled });
  };

  const regenerateResponse = async (metadata?: Record<string, any>) => {
    if (!activeChatId || isStreaming || isSending) return;
    const currentMessages = messagesRef.current;
    const lastUserIndex = currentMessages.findLastIndex((m) => m.role === 'user');
    if (lastUserIndex === -1) return;
    const historyForRegeneration = currentMessages.slice(0, lastUserIndex + 1);
    const messagesWithPlaceholder = [...historyForRegeneration, { role: 'assistant', content: '', isWaiting: true } as Message];
    setMessages(messagesWithPlaceholder);
    await streamAndSaveResponse(activeChatId, historyForRegeneration, { isRegeneration: true, ...metadata, client_time: getLocalTime(), isThinkingEnabled });
  };

  const renameChat = async (chatId: string, newTitle: string) => {
    try {
      await api(`/chats/${chatId}`, { method: 'PUT', body: JSON.stringify({ title: newTitle }) });
      await loadChatList();
      showNotification('Chat renamed!', 'success');
    } catch (e) { showNotification('Rename failed', 'error'); }
  };

  const deleteChat = async (chatId: string) => {
    try {
      await api(`/chats/${chatId}`, { method: 'DELETE' });
      setChatList((prev) => prev.filter((c) => c._id !== chatId));
      if (activeChatId === chatId) { navigate('/', { replace: true }); clearChat(); }
      showNotification('Chat deleted.', 'success');
    } catch (e) { showNotification('Delete failed', 'error'); }
  };

  const clearAllChats = async () => {
    try {
      await api('/chats/all', { method: 'DELETE' });
      setChatList([]); clearChat();
      showNotification('Cleared all chats.', 'success');
    } catch (e) { showNotification('Clear failed', 'error'); }
  };

  const value = {
    messages, chatList, activeChatId, loadChat, clearChat, isLoadingChat, isLoadingChatList, isCreatingChat, isSending,
    sendMessage, isStreaming, editingIndex, startEditing, cancelEditing, saveAndSubmitEdit, regenerateResponse, renameChat,
    isThinking, thinkingContent, isThinkingEnabled, toggleThinking, stopGeneration, deleteChat, clearAllChats, sendGeolocationResult
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

export const useChat = () => {
  const context = useContext(ChatContext);
  if (context === undefined) throw new Error('useChat must be used within a ChatProvider');
  return context;
};