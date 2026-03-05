// src/pages/MainAppLayout.tsx
import { useEffect, useState, Suspense } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import SettingsModal from '../components/SettingsModal';
import Notification from '../components/Notification';
import { ChatProvider } from '../contexts/ChatContext';
import { SidePanelProvider } from '../contexts/SidePanelContext'; 
import SidePanel from '../components/SidePanel'; 
import MobileHeader from '../components/MobileHeader';
import '../css/MobileHeader.css';
import SubscriptionSuccessOverlay from '../components/SubscriptionSuccessOverlay';
import '../css/SubscriptionSuccessOverlay.css';
import api from '../utils/api';
import { useSettings } from '../contexts/SettingsContext';

const RouteFallback = () => (
  <div style={{
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    height: '100%'
  }}>
    <div className="bouncing-loader">
      <div></div>
      <div></div>
      <div></div>
    </div>
  </div>
);

const MainAppLayout = () => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'GPT' | 'Account' | 'Appearance' | 'Integrations' | 'Voice'>('GPT');
  const [isMobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showSubOverlay, setShowSubOverlay] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { loadUser } = useSettings();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.has('sub_success')) {
      setShowSubOverlay(true);
      const cleanPath = location.pathname;
      navigate(cleanPath, { replace: true });
      const refresh = async () => {
        try {
          const res = await api('/stripe/refresh-subscription', { method: 'POST' });
          if (res.ok) {
            await loadUser();
          }
        } catch (error) {
          return;
        }
      };
      refresh();
    }
  }, [location.search, location.pathname, navigate, loadUser]);

  return (
    <>
      {showSubOverlay && (
        <SubscriptionSuccessOverlay onClose={() => setShowSubOverlay(false)} />
      )}
      
      <ChatProvider>
        <SidePanelProvider>
          <Notification />
          <SidePanel /> 

          <MobileHeader 
            onToggleSidebar={() => setMobileSidebarOpen(true)}
            onNewChat={() => {
              navigate('/app');
              setMobileSidebarOpen(false);
            }}
          />
          <div className="app-container">
            <Sidebar 
              onOpenSettings={(tab = 'GPT') => {
                setSettingsInitialTab(tab as any);
                setIsSettingsOpen(true);
              }} 
              isMobileOpen={isMobileSidebarOpen}
              onClose={() => setMobileSidebarOpen(false)}
              isCollapsed={isSidebarCollapsed}
              onToggleCollapse={() => setIsSidebarCollapsed(prev => !prev)}
            />
            <Suspense fallback={<RouteFallback />}>
              <Outlet />
            </Suspense>
          </div>
          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            initialTab={settingsInitialTab}
          />
        </SidePanelProvider>
      </ChatProvider>
    </>
  );
};

export default MainAppLayout;
