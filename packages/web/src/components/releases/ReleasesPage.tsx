import { useEffect, useState } from 'react';
import type { Release, ReleaseCategory, ReleaseEntry, ReleaseImage } from '@fleex/shared';
import { useReleaseStore } from '../../stores/releaseStore';
import { cn } from '../../lib/cn';
import { tint, type TintHue } from '../../lib/tints';
import { MarkdownRenderer } from '../scratchpad/MarkdownRenderer';
import { ImageLightbox } from '../shared/ImageThumbnail';
import { BusyLine } from '../ui/Spinner';

/**
 * Nouveautés (`/releases`): the illustrated release notes shipped in the repo
 * (`releases/`, docs/releases.md). Left: the release history. Right: the
 * selected release. Opening the page marks the newest release as seen, which
 * clears the « Nouveau » badge in the nav.
 */

const REPO_PR_URL = 'https://github.com/oliviermadre/fleex/pull/';

const CATEGORY: Record<ReleaseCategory, { label: string; hue: TintHue }> = {
  feature: { label: 'Feature', hue: 'purple' },
  improvement: { label: 'Amélioration', hue: 'blue' },
  fix: { label: 'Fix', hue: 'green' },
  'under-the-hood': { label: 'Sous le capot', hue: 'gray' },
};

const noop = () => {};

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function countLabel(n: number): string {
  return n === 1 ? '1 nouveauté' : `${n} nouveautés`;
}

/** Image-less fixes and under-the-hood changes go to the compact « Et aussi » list. */
function isMinor(e: ReleaseEntry): boolean {
  return e.images.length === 0 && (e.category === 'fix' || e.category === 'under-the-hood');
}

export function ReleasesPage() {
  const releases = useReleaseStore((s) => s.releases);
  const current = useReleaseStore((s) => s.current);
  const loaded = useReleaseStore((s) => s.loaded);
  const loading = useReleaseStore((s) => s.loading);
  const error = useReleaseStore((s) => s.error);
  const load = useReleaseStore((s) => s.load);
  const markSeen = useReleaseStore((s) => s.markSeen);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    if (!loaded) void load();
    // Mount-only: the nav keeps the list fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Seen as soon as the page shows it (and again if a newer one lands while open).
  useEffect(() => {
    if (current !== null) markSeen();
  }, [current, markSeen]);

  const release = releases.find((r) => r.number === selected) ?? releases[0] ?? null;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 bg-[var(--theme-bg-base)]">
      {!loaded && loading ? (
        <div className="flex flex-1 items-center justify-center">
          <BusyLine label="Chargement des nouveautés…" />
        </div>
      ) : !loaded && error ? (
        <EmptyState title="Impossible de charger les nouveautés" text={error} />
      ) : !release ? (
        <EmptyState
          title="Pas encore de nouveautés"
          text="Chaque version de Fleex apparaîtra ici avec ses nouveautés, illustrées par de vraies captures de l’app. Revenez après la prochaine mise à jour."
        />
      ) : (
        <>
          <ReleaseList releases={releases} selected={release.number} onSelect={setSelected} />
          <div className="min-w-0 flex-1 overflow-y-auto">
            <ReleaseDetail key={release.number} release={release} />
          </div>
        </>
      )}
    </div>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--theme-text-faint)]">
        <rect x="3" y="8" width="18" height="4" rx="1" />
        <path d="M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8" />
        <path d="M12 8v13" />
        <path d="M12 8c-1.5-3-5-4.5-6-2.5S8.5 8 12 8z" />
        <path d="M12 8c1.5-3 5-4.5 6-2.5S15.5 8 12 8z" />
      </svg>
      <p className="text-sm font-medium text-[var(--theme-text-primary)]">{title}</p>
      <p className="max-w-md text-sm text-[var(--theme-text-muted)]">{text}</p>
    </div>
  );
}

function ReleaseList({ releases, selected, onSelect }: { releases: Release[]; selected: number; onSelect: (n: number) => void }) {
  return (
    <nav className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-[var(--theme-border)] py-3" aria-label="Versions">
      <h2 className="px-4 pb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-text-faint)]">Nouveautés</h2>
      {releases.map((r) => {
        const active = r.number === selected;
        return (
          <button
            key={r.number}
            onClick={() => onSelect(r.number)}
            className={cn(
              'flex flex-col gap-0.5 border-l-2 px-4 py-2.5 text-left transition-colors',
              active
                ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)]'
                : 'border-transparent hover:bg-[var(--theme-bg-hover)]',
            )}
          >
            <span className={cn('text-sm font-semibold', active ? 'text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-secondary)]')}>
              Fleex #{r.number}
            </span>
            <span className="text-xs text-[var(--theme-text-muted)]">{formatDate(r.date)}</span>
            <span className="text-xs text-[var(--theme-text-faint)]">{countLabel(r.entries.length)}</span>
          </button>
        );
      })}
    </nav>
  );
}

function ReleaseDetail({ release }: { release: Release }) {
  const major = release.entries.filter((e) => !isMinor(e));
  const minor = release.entries.filter(isMinor);
  return (
    <article className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-8 py-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-baseline gap-3 text-sm text-[var(--theme-text-muted)]">
          <span className="font-semibold text-[var(--theme-accent)]">Fleex #{release.number}</span>
          <span>{formatDate(release.date)}</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--theme-text-primary)]">{release.title}</h1>
        {release.tagline && <p className="text-base text-[var(--theme-text-secondary)]">{release.tagline}</p>}
        {release.themes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {release.themes.map((t) => (
              <span key={t} className="rounded-full bg-[var(--theme-bg-overlay)] px-2.5 py-0.5 text-xs text-[var(--theme-text-secondary)]">
                {t}
              </span>
            ))}
          </div>
        )}
        {release.intro && (
          <div className="pt-2 text-sm text-[var(--theme-text-secondary)]">
            <MarkdownRenderer content={release.intro} profile="doc" onToggleCheckbox={noop} />
          </div>
        )}
      </header>

      {major.map((e) => (
        <EntryBlock key={e.slug} entry={e} />
      ))}

      {minor.length > 0 && (
        <section className="flex flex-col gap-3 border-t border-[var(--theme-border-subtle)] pt-6">
          <h2 className="text-sm font-semibold text-[var(--theme-text-primary)]">Et aussi</h2>
          <ul className="flex flex-col gap-3">
            {minor.map((e) => (
              <li key={e.slug} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <CategoryChip category={e.category} />
                  <span className="text-sm font-medium text-[var(--theme-text-primary)]">{e.title}</span>
                  <PrLinks prs={e.prs} />
                </div>
                <div className="text-sm text-[var(--theme-text-secondary)]">
                  <MarkdownRenderer content={e.body} profile="doc" onToggleCheckbox={noop} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

function EntryBlock({ entry }: { entry: ReleaseEntry }) {
  const hasImages = entry.images.length > 0;
  return (
    <section
     
      className={cn('grid gap-6 border-t border-[var(--theme-border-subtle)] pt-6', hasImages && 'lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]')}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <CategoryChip category={entry.category} />
          <PrLinks prs={entry.prs} />
        </div>
        <h2 className="text-lg font-semibold text-[var(--theme-text-primary)]">{entry.title}</h2>
        <div className="text-sm text-[var(--theme-text-secondary)]">
          <MarkdownRenderer content={entry.body} profile="doc" onToggleCheckbox={noop} />
        </div>
      </div>
      {hasImages && (
        <div className="flex min-w-0 flex-col gap-4">
          {entry.images.map((img) => (
            <Screenshot key={img.src} image={img} />
          ))}
        </div>
      )}
    </section>
  );
}

function CategoryChip({ category }: { category: ReleaseCategory }) {
  const c = CATEGORY[category];
  return <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider', tint(c.hue))}>{c.label}</span>;
}

function PrLinks({ prs }: { prs: number[] }) {
  if (prs.length === 0) return null;
  return (
    <span className="flex gap-1.5 text-xs">
      {prs.map((n) => (
        <a
          key={n}
          href={`${REPO_PR_URL}${n}`}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--theme-text-muted)] hover:text-[var(--theme-accent)] hover:underline"
        >
          #{n}
        </a>
      ))}
    </span>
  );
}

function Screenshot({ image }: { image: ReleaseImage }) {
  const [variant, setVariant] = useState<'dark' | 'light'>('dark');
  const [open, setOpen] = useState(false);
  const src = variant === 'light' && image.light ? image.light : image.src;
  return (
    <figure className="flex flex-col gap-2">
      <button
        onClick={() => setOpen(true)}
        className="overflow-hidden rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] cursor-zoom-in"
        aria-label={`Agrandir : ${image.alt}`}
      >
        <img src={src} alt={image.alt} loading="lazy" className="mx-auto block h-auto max-h-[640px] w-auto max-w-full" />
      </button>
      <div className="flex items-start justify-between gap-3">
        {image.caption ? (
          <figcaption className="text-xs text-[var(--theme-text-muted)]">{image.caption}</figcaption>
        ) : (
          <span />
        )}
        {image.light && (
          <div className="flex shrink-0 overflow-hidden rounded border border-[var(--theme-border)] text-[11px]" role="group" aria-label="Thème de la capture">
            {(['dark', 'light'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setVariant(v)}
                aria-pressed={variant === v}
                className={cn(
                  'px-2 py-0.5 transition-colors',
                  variant === v
                    ? 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]'
                    : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]',
                )}
              >
                {v === 'dark' ? 'Dark' : 'Light'}
              </button>
            ))}
          </div>
        )}
      </div>
      <ImageLightbox src={src} alt={image.caption ?? image.alt} open={open} onClose={() => setOpen(false)} />
    </figure>
  );
}
