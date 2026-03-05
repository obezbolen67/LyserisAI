// src/components/StreamingText.tsx
import { useState, useEffect, useRef, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import '../css/StreamingText.css';

interface StreamingTextProps {
  content: string;
  isStreaming: boolean;
  components?: Components;
}

const DISPLAY_SPEED = 35; // Display new content every 35ms for smooth animation (1.5x faster)
const CATCHUP_SPEED = 10; // Much faster when catching up after streaming ends

const StreamingText = memo(({ content, isStreaming, components }: StreamingTextProps) => {
  const [displayedContent, setDisplayedContent] = useState(content);
  const bufferRef = useRef(content);
  const displayedLengthRef = useRef(content.length);
  const timerRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isCatchingUpRef = useRef(false);
  const hasStartedStreamingRef = useRef(false);

  useEffect(() => {
    if (!isStreaming && !isCatchingUpRef.current) {
      // Streaming ended - switch to catch-up mode
      const buffer = content; // Use latest content
      const currentDisplayed = displayedLengthRef.current;
      
      if (currentDisplayed < buffer.length) {
        // There's remaining content - speed up to catch up
        isCatchingUpRef.current = true;
        bufferRef.current = buffer;
        
        // Clear existing timer and start faster one
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        
        // Use setTimeout chain for catch-up to ensure it runs
        const catchUpNextChunk = () => {
          const currentBuffer = bufferRef.current;
          const displayed = displayedLengthRef.current;
          
          if (displayed >= currentBuffer.length) {
            // Fully caught up
            isCatchingUpRef.current = false;
            return;
          }

          // Display more content - show ~3-5 words at a time
          const remainingContent = currentBuffer.substring(displayed);
          const words = remainingContent.split(/\s+/).filter(w => w.trim());
          
          if (words.length === 0) {
            isCatchingUpRef.current = false;
            return;
          }
          
          // Take 3-5 words
          const wordsToShow = Math.min(words.length, Math.floor(Math.random() * 3) + 3);
          const chunkLength = remainingContent.split(/\s+/).slice(0, wordsToShow).join(' ').length + 1;
          
          const newDisplayLength = Math.min(displayed + chunkLength, currentBuffer.length);
          const newContent = currentBuffer.substring(0, newDisplayLength);
          
          setDisplayedContent(newContent);
          displayedLengthRef.current = newDisplayLength;
          
          // Schedule next chunk
          setTimeout(catchUpNextChunk, CATCHUP_SPEED);
        };
        
        // Start catch-up
        setTimeout(catchUpNextChunk, CATCHUP_SPEED);
      }
      
      return;
    }

    // Update buffer with new content
    bufferRef.current = content;

    // Only start streaming if content is actually growing
    if (!hasStartedStreamingRef.current) {
      hasStartedStreamingRef.current = true;
      displayedLengthRef.current = 0;
      setDisplayedContent('');
    }

    // Start interval to gradually display buffered content
    if (!timerRef.current) {
      timerRef.current = setInterval(() => {
        const buffer = bufferRef.current;
        const currentDisplayed = displayedLengthRef.current;
        
        if (currentDisplayed >= buffer.length) {
          // We've caught up, no need to update
          return;
        }

        // Display more content - show ~3-5 words at a time
        const remainingContent = buffer.substring(currentDisplayed);
        const words = remainingContent.split(/\s+/).filter(w => w.trim());
        
        if (words.length === 0) return;
        
        // Take 3-5 words
        const wordsToShow = Math.min(words.length, Math.floor(Math.random() * 3) + 3);
        const chunkLength = remainingContent.split(/\s+/).slice(0, wordsToShow).join(' ').length + 1;
        
        const newDisplayLength = Math.min(currentDisplayed + chunkLength, buffer.length);
        const newContent = buffer.substring(0, newDisplayLength);
        
        setDisplayedContent(newContent);
        displayedLengthRef.current = newDisplayLength;
      }, DISPLAY_SPEED);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [content, isStreaming]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  // Use displayed content only if streaming has started, otherwise show full content
  const currentDisplayText = (isStreaming || isCatchingUpRef.current) && hasStartedStreamingRef.current 
    ? displayedContent 
    : content;

  const previousLengthRef = useRef(currentDisplayText.length);
  const [showNewContent, setShowNewContent] = useState(false);

  useEffect(() => {
    if (currentDisplayText.length > previousLengthRef.current) {
      setShowNewContent(true);
      const timer = setTimeout(() => setShowNewContent(false), 300);
      previousLengthRef.current = currentDisplayText.length;
      return () => clearTimeout(timer);
    }
  }, [currentDisplayText]);

  return (
    <div 
      ref={containerRef}
      className={`streaming-text-container ${isStreaming ? 'is-streaming' : ''} ${showNewContent ? 'content-updating' : ''}`}
    >
      <div className="markdown-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
          rehypePlugins={[rehypeKatex]}
          components={components}
        >
          {currentDisplayText}
        </ReactMarkdown>
      </div>
    </div>
  );
});

StreamingText.displayName = 'StreamingText';

export default StreamingText;
