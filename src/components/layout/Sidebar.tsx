import { useState, useEffect } from 'react';
import { LayoutDashboard, Rss, Mic, Settings, Headphones, CloudOff, CloudLightning, Cloud, Sun, Moon, PanelLeftClose, PanelLeft } from 'lucide-react';
import { ViewState } from '../../App';

interface SidebarProps {
  currentView: ViewState;
  onNavigate: (view: ViewState) => void;
}

export default function Sidebar({ currentView, onNavigate }: SidebarProps) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'sources', label: 'Sources', icon: Rss },
    { id: 'runs', label: 'Briefing Runs', icon: Mic },
    { id: 'settings', label: 'Settings', icon: Settings },
  ] as const;

  return (
    <aside className={`sidebar${isCollapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="sidebar__header">
        <div className="sidebar__brand">
          <div className="sidebar__brand-icon">
            <Headphones size={18} />
          </div>
          {!isCollapsed && <span className="sidebar__brand-text">LocalCast</span>}
        </div>
        
        <div className="sidebar__actions">
          <button
            onClick={() => setIsDark(!isDark)}
            className="icon-button"
            aria-label="Toggle Dark Mode"
            title="Toggle Dark Mode"
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="icon-button"
            aria-label={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
            title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          >
            {isCollapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
      </div>

      <nav className="sidebar__nav" aria-label="Primary navigation">
        {navItems.map((item) => {
          const isActive = currentView === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              title={isCollapsed ? item.label : undefined}
              className="sidebar__nav-item"
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon size={isCollapsed ? 22 : 18} className="sidebar__nav-icon" />
              {!isCollapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      <div className="sidebar__footer">
        <div className="connection-status" title={isOnline ? "Online & Synced" : "Offline"}>
          {isOnline ? (
            <>
              <div className="status-dot" data-status="online">
                <span className="status-dot__ping"></span>
                <span className="status-dot__core"></span>
              </div>
              {!isCollapsed && <span>Online & Synced</span>}
            </>
          ) : (
            <>
              <div className="status-dot" data-status="offline">
                <span className="status-dot__core"></span>
              </div>
              {!isCollapsed && <span>Offline</span>}
            </>
          )}
        </div>
        {!isCollapsed && (
          <div className="local-note">
            <p className="local-note__label">Local-First</p>
            <p className="local-note__copy">
              Your sources and generated transcripts stay on this device.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
