import { ListLink, TopBar } from '../../components/ui';

export function MoreMenu() {
  return (
    <main className="page">
      <TopBar title="More" />
      <ul className="list card">
        <li>
          <ListLink href="#/trips" icon="calendar" title="All trips" meta="Upcoming and past" />
        </li>
        <li>
          <ListLink href="#/essentials" icon="car" title="Road trip essentials" meta="Vehicle kit and pre-departure checks" />
        </li>
        <li>
          <ListLink href="#/profiles" icon="users" title="Family profiles" meta="Ages, preferences, drivers" />
        </li>
        <li>
          <ListLink href="#/history" icon="history" title="Packing history" meta="Reviews, learning, always-pack list" />
        </li>
        <li>
          <ListLink href="#/settings" icon="settings" title="Settings and backup" meta="Theme, assumptions, export, restore, privacy" />
        </li>
      </ul>
      <p className="muted small" style={{ marginTop: 24 }}>
        Milestone runs entirely on this device. No account, no AI, no analytics.
      </p>
    </main>
  );
}
