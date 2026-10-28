import {useEffect, useState} from 'react';
import {Cloud, CloudOff, Headphones, LayoutDashboard, Mic, Moon, PanelLeft, PanelLeftClose, Radio, Rss, Settings, Sun} from 'lucide-react';
import {NavLink} from 'react-router-dom';

const navItems = [
  {to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true},
  {to: '/stations', label: 'Stations & Notes', icon: Radio},
  {to: '/sources', label: 'Sources', icon: Rss},
  {to: '/episodes', label: 'Episodes', icon: Mic},
  {to: '/settings', label: 'Settings', icon: Settings},
] as const;

export default function Sidebar() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  useEffect(() => {
    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);

  return (
    <aside className={`sidebar${isCollapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="sidebar__header">
        <div className="sidebar__brand">
          <div className="sidebar__brand-icon"><Headphones size={18} /></div>
          {!isCollapsed && <span className="sidebar__brand-text">LocalCast</span>}
        </div>
        <div className="sidebar__actions">
          <button onClick={() => setIsDark(current => !current)} className="icon-button" aria-label="Toggle dark mode">
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button onClick={() => setIsCollapsed(current => !current)} className="icon-button" aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {isCollapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
      </div>

      <nav className="sidebar__nav" aria-label="Primary navigation">
        {navItems.map(item => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={'end' in item ? item.end : false}
              title={isCollapsed ? item.label : undefined}
              className="sidebar__nav-item"
            >
              <Icon size={isCollapsed ? 22 : 18} className="sidebar__nav-icon" />
              {!isCollapsed && <span>{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>

      <div className="sidebar__footer">
        <div className="connection-status" title={isOnline ? 'Browser network available' : 'Browser offline'}>
          {isOnline ? <Cloud size={16} /> : <CloudOff size={16} />}
          {!isCollapsed && <span>{isOnline ? 'Network available' : 'Offline'}</span>}
        </div>
        {!isCollapsed && (
          <div className="local-note">
            <p className="local-note__label">Trusted LAN</p>
            <p className="local-note__copy">Supplied material is stored on this server. Configured external providers receive only the disclosed generation or chat inputs after your explicit action.</p>
          </div>
        )}
      </div>
    </aside>
  );
}
