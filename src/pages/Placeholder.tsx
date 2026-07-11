import { PageHeader } from '../components/layout/PageHeader';

interface PlaceholderProps {
  title: string;
}

export function Placeholder({ title }: PlaceholderProps) {
  return (
    <div>
      <PageHeader serif label="Overview" title={title} />
      <div
        className="rounded-xl p-8 text-center"
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          color: 'var(--text-muted)',
          borderRadius: 'var(--radius-2)',
        }}
      >
        <p
          className="mb-2"
          style={{
            fontSize: 'var(--fs-h3)',
            color: 'var(--text-secondary)',
          }}
        >
          Coming soon
        </p>
        <p style={{ fontSize: 'var(--fs-body-sm)' }}>
          This page will be implemented in a future phase.
        </p>
      </div>
    </div>
  );
}
