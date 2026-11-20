import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { TopNav } from '@/components/TopNav';

/**
 * Fixed global header entrypoint. Main links and hover subnav (including Housing → ?type=on-campus|off-campus)
 * are implemented in `TopNav`.
 */
type CoreTab = 'campus' | 'map' | 'profile';
type TopNavTab = CoreTab | 'marketplace' | 'roommates' | 'guide';

export function GlobalTopNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const pathname = location.pathname;

  const handleTabChange = (tab: CoreTab) => {
    if (tab === 'map') {
      navigate('/map');
      return;
    }
    if (tab === 'profile') {
      navigate('/profile');
      return;
    }
    navigate('/campus', { state: { activeTab: tab } });
  };

  let activeTab: TopNavTab;

  if (pathname === '/checklist') {
    activeTab = 'guide';
  } else if (pathname.startsWith('/marketplace')) {
    activeTab = 'marketplace';
  } else if (pathname.startsWith('/roommates')) {
    activeTab = 'roommates';
  } else if (pathname === '/map') {
    activeTab = 'map';
  } else if (pathname === '/profile') {
    activeTab = 'profile';
  } else if (pathname === '/' || pathname.startsWith('/campus')) {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'profile') {
      activeTab = 'profile';
    } else {
      activeTab = 'campus';
    }
  } else {
    activeTab = 'campus';
  }

  return <TopNav activeTab={activeTab} onTabChange={handleTabChange} />;
}

