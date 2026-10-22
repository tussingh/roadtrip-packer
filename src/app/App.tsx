import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { Toast } from '../components/ui';
import { Dashboard } from '../features/dashboard/Dashboard';
import { ChecklistView } from '../features/checklists/ChecklistView';
import { ReadinessView } from '../features/checklists/ReadinessView';
import { EssentialsView } from '../features/essentials/EssentialsView';
import { HistoryView } from '../features/history/HistoryView';
import { ReviewWizard } from '../features/history/ReviewWizard';
import { InventoryView } from '../features/inventory/InventoryView';
import { MoreMenu } from '../features/settings/MoreMenu';
import { SettingsView } from '../features/settings/SettingsView';
import { ProfileEditor, ProfilesView } from '../features/profiles/ProfilesView';
import { TripSummary } from '../features/trips/TripSummary';
import { TripWizard } from '../features/trips/TripWizard';
import { TripsList } from '../features/trips/TripsList';
import { PackRedirect } from '../features/trips/PackRedirect';
import { ensureSeeded, getSettings } from '../storage/repo';
import { bump, clearToast, useOnline, useQuery, useRoute, useToast } from './store';

const MapsView = lazy(() => import('../features/maps/MapsView'));

class Boundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <main className="page">
          <div className="empty">
            <Icon name="warn" size={40} />
            <h2>This screen hit a problem</h2>
            <p>Your data is stored on this device and has not been changed. Go back and try again.</p>
            <p className="small muted">{this.state.error.message}</p>
            <a className="btn" href="#/" onClick={() => this.setState({ error: undefined })}>
              Go to home
            </a>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

function useTheme() {
  const { data: settings } = useQuery(getSettings, []);
  useEffect(() => {
    const pref = settings?.theme ?? 'system';
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = pref === 'dark' || (pref === 'system' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#13181B' : '#0E5E46');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings?.theme]);
}

const TABS: { href: string; label: string; icon: IconName; match: (r: string[]) => boolean }[] = [
  { href: '#/', label: 'Home', icon: 'home', match: (r) => r.length === 0 || r[0] === 'trips' || (r[0] === 'trip' && !['pack', 'ready'].includes(r[2] ?? '')) },
  { href: '#/pack', label: 'Pack', icon: 'pack', match: (r) => r[0] === 'pack' || (r[0] === 'trip' && ['pack', 'ready'].includes(r[2] ?? '')) },
  { href: '#/maps', label: 'Maps', icon: 'map', match: (r) => r[0] === 'maps' },
  { href: '#/inventory', label: 'Inventory', icon: 'box', match: (r) => r[0] === 'inventory' },
  { href: '#/more', label: 'More', icon: 'more', match: (r) => ['more', 'settings', 'profiles', 'history', 'essentials'].includes(r[0] ?? '') },
];

function Screen({ route }: { route: string[] }) {
  const [a, b, c] = route;
  if (!a) return <Dashboard />;
  if (a === 'trips' && b === 'new') return <TripWizard />;
  if (a === 'trips') return <TripsList />;
  if (a === 'trip' && b) {
    if (c === 'edit') return <TripWizard tripId={b} />;
    if (c === 'pack') return <ChecklistView tripId={b} />;
    if (c === 'ready') return <ReadinessView tripId={b} />;
    if (c === 'review') return <ReviewWizard tripId={b} />;
    return <TripSummary tripId={b} />;
  }
  if (a === 'pack') return <PackRedirect />;
  if (a === 'maps')
    return (
      <Suspense fallback={<main className="page"><p className="muted">Loading maps…</p></main>}>
        <MapsView />
      </Suspense>
    );
  if (a === 'essentials') return <EssentialsView />;
  if (a === 'profiles') return b ? <ProfileEditor profileId={b} /> : <ProfilesView />;
  if (a === 'inventory') return <InventoryView />;
  if (a === 'history') return <HistoryView />;
  if (a === 'settings') return <SettingsView />;
  if (a === 'more') return <MoreMenu />;
  return (
    <main className="page">
      <div className="empty">
        <h2>Page not found</h2>
        <a className="btn" href="#/">
          Go to home
        </a>
      </div>
    </main>
  );
}

export function App() {
  const route = useRoute();
  const online = useOnline();
  const toast = useToast();
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string>();
  useTheme();

  useEffect(() => {
    ensureSeeded()
      .then(() => {
        bump();
        setReady(true);
      })
      .catch((e: unknown) => setInitError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.join('/')]);

  if (initError) {
    return (
      <main className="page">
        <div className="empty">
          <Icon name="warn" size={40} />
          <h2>Local storage is unavailable</h2>
          <p>Milestone keeps everything on this device using IndexedDB, which this browser blocked. Private browsing modes often do this — open the app in a normal window.</p>
          <p className="small muted">{initError}</p>
        </div>
      </main>
    );
  }

  return (
    <div className="app">
      {!online && (
        <div className="offline-flag" role="status">
          <Icon name="offline" size={16} /> Offline — everything on this device still works
        </div>
      )}
      <Boundary key={route.join('/')}>{ready ? <Screen route={route} /> : <main className="page" aria-busy="true" />}</Boundary>
      <nav className="nav" aria-label="Main">
        <ul>
          {TABS.map((t) => (
            <li key={t.href}>
              <a href={t.href} aria-current={t.match(route) ? 'page' : undefined}>
                <Icon name={t.icon} />
                {t.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {toast && <Toast key={toast.id} message={toast.message} action={toast.action} onAction={toast.onAction} onDone={() => clearToast(toast.id)} />}
    </div>
  );
}
