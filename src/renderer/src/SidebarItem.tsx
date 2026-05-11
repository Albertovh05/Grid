import { useActivity } from './useActivity';
import type { TerminalSpec } from '../../shared/types';

interface Props {
  spec: TerminalSpec;
  index: number;
  active: boolean;
  onClick: () => void;
  onClose: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export function SidebarItem({ spec, index, active, onClick, onClose, onContextMenu }: Props) {
  const activity = useActivity(spec.id);
  return (
    <div
      className={`term-item ${active ? 'active' : ''} ${activity.bell ? 'bell' : ''} ${
        activity.unread ? 'unread' : ''
      }`}
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu?.(e);
      }}
    >
      <span className={`dot ${activity.unread ? 'on' : ''}`} />
      <span className="name">
        {index + 1}. {spec.title}
      </span>
      <button
        className="close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        title="Close"
      >
        ✕
      </button>
    </div>
  );
}
