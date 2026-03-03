// FexoApp/src/pages/LandingPage.tsx
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import LandingNav from '../components/LandingNav';
import { FiCode, FiSearch, FiFileText, FiShare2, FiArrowRight } from 'react-icons/fi';
import '../css/LandingPage.css';

const features = [
  {
    icon: <FiCode />,
    title: 'Stateful Code Interpreter',
    description: 'Go beyond chat. Execute Python code in a persistent, stateful environment. Perfect for data analysis, prototyping, and complex problem-solving.',
  },
  {
    icon: <FiSearch />,
    title: 'Live Web Research',
    description: 'Stay up-to-date with integrated Google Search for both text and images. Get current information, find data, and see the world without leaving your chat.',
  },
  {
    icon: <FiFileText />,
    title: 'Intelligent Document Analysis',
    description: "Instantly extract and understand insights from your documents. Lyseris AI can read and analyze PDF and PowerPoint files, summarizing content on demand.",
  },
  {
    icon: <FiShare2 />,
    title: 'Multi-Model Freedom',
    description: "Don't get locked in. Bring your own API key for OpenAI, Anthropic, Gemini, or any compatible endpoint. You have full control over your tools.",
  },
];

const steps = [
  {
    icon: '💬',
    title: 'Start with a Prompt',
    description: 'Describe your task, ask a question, or upload your files. Use natural language to explain what you need.',
  },
  {
    icon: '🧠',
    title: 'AI Analyzes & Plans',
    description: 'Lyseris AI interprets your request and determines the best tools for the job, whether it\'s running code, searching the web, or analyzing a document.',
  },
  {
    icon: '🛠️',
    title: 'Tools Are Executed',
    description: 'The AI transparently uses its tools. Watch as it writes and runs Python code, pulls live data, or extracts text from your PDFs.',
  },
  {
    icon: '📊',
    title: 'Receive Your Results',
    description: 'Get your answer, generated data, plots, or files, all within the same conversational interface. Iterate and refine as needed.',
  },
];

const useCases = [
    {
        title: "Data Scientists",
        description: "Quickly clean, analyze, and visualize datasets without switching contexts. Prototype models and generate plots on the fly.",
        color: "hsla(210, 80%, 70%, 1)"
    },
    {
        title: "Developers",
        description: "Scaffold new projects, debug code snippets, and interact with APIs using the persistent Python environment.",
        color: "hsla(145, 63%, 60%, 1)"
    },
    {
        title: "Researchers & Students",
        description: "Summarize research papers, extract data from PDFs, and perform web searches to gather information for your projects.",
        color: "hsla(300, 70%, 70%, 1)"
    }
];

// A hook for the typing effect
const useTypingEffect = (text: string, duration: number, startDelay: number) => {
    const [typedText, setTypedText] = useState('');
    const [hasStarted, setHasStarted] = useState(false);

    useEffect(() => {
        const startTimer = setTimeout(() => {
            setHasStarted(true);
        }, startDelay);

        return () => clearTimeout(startTimer);
    }, [startDelay]);
    
    useEffect(() => {
        if (hasStarted && text) {
            setTypedText('');
            let i = 0;
            const interval = setInterval(() => {
                if(i < text.length) {
                    setTypedText(prev => prev + text.charAt(i));
                    i++;
                } else {
                    clearInterval(interval);
                }
            }, duration / text.length);
            return () => clearInterval(interval);
        }
    }, [text, duration, hasStarted]);

    return typedText;
};


const LandingPage = () => {
  const sectionsRef = useRef<(HTMLElement | null)[]>([]);

  // Typing effect for the hero subtitle
  const heroSubtitleText = "A seamless fusion of large language models and powerful development tools. Analyze data, search the web, and build with a persistent coding environment at your fingertips.";
  const typedSubtitle = useTypingEffect(heroSubtitleText, 2000, 500);


  useEffect(() => {
    // --- START OF THE FIX ---
    // Capture the current sections in a local variable.
    const currentSections = sectionsRef.current;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 }
    );

    // Use the local variable to set up the observers.
    currentSections.forEach((section) => {
      if (section) observer.observe(section);
    });

    // Use the same local variable in the cleanup function.
    return () => {
      currentSections.forEach((section) => {
        if (section) observer.unobserve(section);
      });
    };
    // --- END OF THE FIX ---
  }, []);

  return (
    <div className="landing-page">
      <LandingNav />
      
      <main>
        <section className="hero-section" ref={(el) => { sectionsRef.current[0] = el; }}>
          <div className="hero-background-aurora"></div>
          <div className="hero-content">
            <h1 className="hero-title">The AI Copilot That Actually Builds With You</h1>
            <p className="hero-subtitle">
              {typedSubtitle}
              <span className="typing-cursor">|</span>
            </p>
            <div className="hero-cta">
              <Link to="/register" className="cta-button">
                Get Started for Free <FiArrowRight />
              </Link>
            </div>
          </div>
        </section>

        <section className="features-section" id="features" ref={(el) => { sectionsRef.current[1] = el; }}>
          <h2 className="section-title">A Toolkit for Modern Development</h2>
          <p className="section-subtitle">Everything you need, integrated and intelligent.</p>
          <div className="features-grid">
            {features.map((feature, index) => (
              <div key={index} className="feature-card" ref={(el) => { sectionsRef.current[2 + index] = el; }}>
                <div className="feature-icon">{feature.icon}</div>
                <h3 className="feature-title">{feature.title}</h3>
                <p className="feature-description">{feature.description}</p>
              </div>
            ))}
          </div>
        </section>
        
        <section className="how-it-works-section" ref={(el) => { sectionsRef.current[6] = el; }}>
            <h2 className="section-title">Simple Workflow, Powerful Results</h2>
            <p className="section-subtitle">Four steps from idea to execution.</p>
            <div className="timeline">
                {steps.map((step, index) => (
                    <div key={index} className="timeline-item" ref={(el) => { sectionsRef.current[7 + index] = el; }}>
                        <div className="timeline-icon">{step.icon}</div>
                        <div className="timeline-content">
                            <h3 className="timeline-title">{step.title}</h3>
                            <p className="timeline-description">{step.description}</p>
                        </div>
                    </div>
                ))}
            </div>
        </section>

        <section className="use-cases-section" ref={(el) => { sectionsRef.current[11] = el; }}>
          <h2 className="section-title">Designed For Doers</h2>
          <p className="section-subtitle">Whether you're a developer, analyst, or researcher, Lyseris accelerates your workflow.</p>
          <div className="use-cases-grid">
            {useCases.map((useCase, index) => (
              <div key={index} className="use-case-card" style={{ '--glow-color': useCase.color } as React.CSSProperties} ref={(el) => { sectionsRef.current[12 + index] = el; }}>
                <div className="use-case-glow"></div>
                <h3 className="use-case-title">{useCase.title}</h3>
                <p className="use-case-description">{useCase.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="cta-section" ref={(el) => { sectionsRef.current[15] = el; }}>
            <h2 className="section-title">Ready to build faster?</h2>
            <p className="section-subtitle">
                Sign up now and experience a more powerful way to interact with AI.
            </p>
            <Link to="/register" className="cta-button">
                Create Your Account <FiArrowRight />
            </Link>
        </section>
      </main>

      <footer className="landing-footer">
          <p>&copy; {new Date().getFullYear()} Lyseris AI. All rights reserved.</p>
      </footer>
    </div>
  );
};

export default LandingPage;
